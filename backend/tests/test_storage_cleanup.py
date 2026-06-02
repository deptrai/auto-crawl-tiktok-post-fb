import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.models.models import Base, Video, VideoStatus, TaskQueue, TaskStatus
from app.worker import cron
from app.worker.cron import storage_cleanup_job, start_scheduler


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def attach_phase3_schema(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("ATTACH DATABASE ':memory:' AS phase3")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine, expire_on_commit=False)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def cleanup_env(db_session, monkeypatch):
    """Mọi test cleanup đều cần: SessionLocal trả wrapped session, get_storage
    + record_event được patch tại đúng module path (`app.worker.cron`).
    """
    mock_session = MagicMock(wraps=db_session)
    mock_session.close.side_effect = lambda: None

    monkeypatch.setattr(cron, "SessionLocal", lambda: mock_session)

    storage = MagicMock()
    monkeypatch.setattr(cron, "get_storage", lambda: storage)

    # Patch record_event tại nơi nó được sử dụng (cron.py) — KHÔNG patch ở
    # `app.services.observability` vì cron.py đã `from ... import record_event`.
    record_mock = MagicMock()
    monkeypatch.setattr(cron, "record_event", record_mock)

    return {"db": db_session, "storage": storage, "record_event": record_mock}


@pytest.fixture
def cleanup_days(monkeypatch):
    """Helper để set/restore settings.CLEANUP_FAILED_VIDEO_DAYS không leak."""
    def _setter(value: int):
        monkeypatch.setattr(cron.settings, "CLEANUP_FAILED_VIDEO_DAYS", value)
    return _setter


def _now_naive():
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# AC1 — posted videos > 24h get cleaned, file_path → None
# ---------------------------------------------------------------------------


def test_cleanup_posted_videos_older_than_24h(cleanup_env, cleanup_days):
    cleanup_days(7)
    db = cleanup_env["db"]
    storage = cleanup_env["storage"]

    now = _now_naive()
    old = now - timedelta(hours=25)

    vid_old = Video(id=uuid.uuid4(), status=VideoStatus.posted, file_path="/p/old.mp4", publish_time=old)
    vid_new = Video(id=uuid.uuid4(), status=VideoStatus.posted, file_path="/p/new.mp4", publish_time=now)
    db.add_all([vid_old, vid_new])
    db.commit()

    storage_cleanup_job()

    storage.delete.assert_any_call("/p/old.mp4")
    db.refresh(vid_old)
    db.refresh(vid_new)
    assert vid_old.file_path is None
    assert vid_new.file_path == "/p/new.mp4"


# ---------------------------------------------------------------------------
# AC2 — skip video đang trong active retry queue
# ---------------------------------------------------------------------------


def test_cleanup_skips_video_in_active_retry_queue(cleanup_env, cleanup_days):
    cleanup_days(0)  # disable failed cleanup để focus AC2
    db = cleanup_env["db"]
    storage = cleanup_env["storage"]

    old = _now_naive() - timedelta(hours=25)
    vid = Video(id=uuid.uuid4(), status=VideoStatus.posted, file_path="/p/locked.mp4", publish_time=old)
    db.add(vid)
    db.commit()

    db.add(TaskQueue(
        id=uuid.uuid4(),
        entity_id=str(vid.id),
        category="retry_video_download",
        status=TaskStatus.queued,
    ))
    db.commit()

    storage_cleanup_job()

    storage.delete.assert_not_called()
    db.refresh(vid)
    assert vid.file_path == "/p/locked.mp4"


def test_cleanup_skips_processing_status_too(cleanup_env, cleanup_days):
    cleanup_days(0)
    db = cleanup_env["db"]
    storage = cleanup_env["storage"]

    old = _now_naive() - timedelta(hours=25)
    vid = Video(id=uuid.uuid4(), status=VideoStatus.posted, file_path="/p/proc.mp4", publish_time=old)
    db.add(vid)
    db.commit()
    db.add(TaskQueue(
        id=uuid.uuid4(),
        entity_id=str(vid.id),
        category="retry_video_download",
        status=TaskStatus.processing,
    ))
    db.commit()

    storage_cleanup_job()
    storage.delete.assert_not_called()


def test_cleanup_ignores_unrelated_task_types(cleanup_env, cleanup_days):
    """Task khác type (vd: thumbnail-gen) không được block cleanup."""
    cleanup_days(0)
    db = cleanup_env["db"]
    storage = cleanup_env["storage"]

    old = _now_naive() - timedelta(hours=25)
    vid = Video(id=uuid.uuid4(), status=VideoStatus.posted, file_path="/p/v.mp4", publish_time=old)
    db.add(vid)
    db.commit()
    db.add(TaskQueue(
        id=uuid.uuid4(),
        entity_id=str(vid.id),
        category="some_other_task",
        status=TaskStatus.queued,
    ))
    db.commit()

    storage_cleanup_job()
    storage.delete.assert_called_once_with("/p/v.mp4")


# ---------------------------------------------------------------------------
# AC3 — failed videos cleanup configurable
# ---------------------------------------------------------------------------


def test_cleanup_failed_videos_when_enabled(cleanup_env, cleanup_days):
    cleanup_days(7)
    db = cleanup_env["db"]
    storage = cleanup_env["storage"]

    now = _now_naive()
    vid = Video(
        id=uuid.uuid4(),
        status=VideoStatus.failed,
        file_path="/p/failed.mp4",
        updated_at=now - timedelta(days=10),
    )
    db.add(vid)
    db.commit()

    storage_cleanup_job()

    storage.delete.assert_any_call("/p/failed.mp4")
    db.refresh(vid)
    assert vid.file_path is None
    assert vid.status == VideoStatus.failed  # status không đổi


def test_cleanup_failed_videos_disabled_when_zero(cleanup_env, cleanup_days):
    cleanup_days(0)
    db = cleanup_env["db"]
    storage = cleanup_env["storage"]

    vid = Video(
        id=uuid.uuid4(),
        status=VideoStatus.failed,
        file_path="/p/failed2.mp4",
        updated_at=_now_naive() - timedelta(days=30),
    )
    db.add(vid)
    db.commit()

    storage_cleanup_job()

    storage.delete.assert_not_called()
    db.refresh(vid)
    assert vid.file_path == "/p/failed2.mp4"


# ---------------------------------------------------------------------------
# AC5 — storage-agnostic: file đã không tồn tại → file_path=NULL anyway, no error
# ---------------------------------------------------------------------------


def test_cleanup_when_storage_delete_returns_false(cleanup_env, cleanup_days):
    """storage.delete trả False (file đã mất) — DB ref vẫn được clear."""
    cleanup_days(0)
    db = cleanup_env["db"]
    storage = cleanup_env["storage"]
    storage.delete.return_value = False

    old = _now_naive() - timedelta(hours=25)
    vid = Video(id=uuid.uuid4(), status=VideoStatus.posted, file_path="/p/gone.mp4", publish_time=old)
    db.add(vid)
    db.commit()

    storage_cleanup_job()

    db.refresh(vid)
    assert vid.file_path is None  # cleared dù storage.delete trả False


def test_cleanup_when_storage_delete_raises(cleanup_env, cleanup_days):
    """storage.delete raise (transient error) — giữ DB ref để retry sau."""
    cleanup_days(0)
    db = cleanup_env["db"]
    storage = cleanup_env["storage"]
    storage.delete.side_effect = RuntimeError("S3 timeout")

    old = _now_naive() - timedelta(hours=25)
    vid = Video(id=uuid.uuid4(), status=VideoStatus.posted, file_path="/p/transient.mp4", publish_time=old)
    db.add(vid)
    db.commit()

    storage_cleanup_job()

    db.refresh(vid)
    assert vid.file_path == "/p/transient.mp4"  # giữ nguyên để retry


# ---------------------------------------------------------------------------
# AC1 — summary event chỉ ghi khi cleaned_count > 0
# ---------------------------------------------------------------------------


def test_no_event_when_zero_cleanup(cleanup_env, cleanup_days):
    cleanup_days(0)
    record = cleanup_env["record_event"]

    # DB rỗng → 0 cleanup → không có event
    storage_cleanup_job()

    info_calls = [c for c in record.call_args_list if "cleanup" in str(c)]
    assert info_calls == []


def test_event_recorded_when_cleanup_happens(cleanup_env, cleanup_days):
    cleanup_days(0)
    db = cleanup_env["db"]
    record = cleanup_env["record_event"]

    old = _now_naive() - timedelta(hours=25)
    db.add(Video(id=uuid.uuid4(), status=VideoStatus.posted, file_path="/p/e.mp4", publish_time=old))
    db.commit()

    storage_cleanup_job()

    # Có ít nhất 1 call info cleanup
    matched = [
        c for c in record.call_args_list
        if c.args and c.args[0] == "cleanup" and c.args[1] == "info"
    ]
    assert len(matched) == 1
    details = matched[0].kwargs.get("details", {})
    assert details.get("cleaned_count") == 1


# ---------------------------------------------------------------------------
# Edge: empty file_path / null publish_time
# ---------------------------------------------------------------------------


def test_empty_file_path_is_skipped(cleanup_env, cleanup_days):
    cleanup_days(0)
    db = cleanup_env["db"]
    storage = cleanup_env["storage"]

    old = _now_naive() - timedelta(hours=25)
    vid = Video(id=uuid.uuid4(), status=VideoStatus.posted, file_path="", publish_time=old)
    db.add(vid)
    db.commit()

    storage_cleanup_job()
    storage.delete.assert_not_called()


def test_posted_with_null_publish_time_is_cleaned(cleanup_env, cleanup_days):
    """Video posted nhưng publish_time NULL không được starve mãi mãi."""
    cleanup_days(0)
    db = cleanup_env["db"]
    storage = cleanup_env["storage"]

    vid = Video(id=uuid.uuid4(), status=VideoStatus.posted, file_path="/p/np.mp4", publish_time=None)
    db.add(vid)
    db.commit()

    storage_cleanup_job()
    storage.delete.assert_called_once_with("/p/np.mp4")


# ---------------------------------------------------------------------------
# AC4 — scheduler đăng ký storage_cleanup_job đúng config
# ---------------------------------------------------------------------------


def test_start_scheduler_registers_storage_cleanup_job(monkeypatch):
    captured = []

    def fake_add_job(func, *args, **kwargs):
        captured.append({"func": func, "args": args, "kwargs": kwargs})

    monkeypatch.setattr(cron.scheduler, "get_job", lambda _id: None)
    monkeypatch.setattr(cron.scheduler, "add_job", fake_add_job)
    monkeypatch.setattr(cron.scheduler, "start", lambda: None)
    # tránh scheduler.running True → start_scheduler nhảy qua start
    monkeypatch.setattr(type(cron.scheduler), "running", property(lambda self: False))

    start_scheduler()  # không raise (timedelta đã được import top-level)

    cleanup_jobs = [j for j in captured if j["kwargs"].get("id") == "storage_cleanup_job"]
    assert len(cleanup_jobs) == 1
    job = cleanup_jobs[0]
    assert job["func"] is storage_cleanup_job
    assert job["kwargs"]["hours"] == 6
    assert job["kwargs"]["max_instances"] == 1
    assert job["kwargs"]["coalesce"] is True
    # next_run_time ~ now + 10 phút
    next_run = job["kwargs"]["next_run_time"]
    delta = (next_run - _now_naive()).total_seconds()
    assert 9 * 60 <= delta <= 11 * 60

# Story 8.2: Tự Động Dọn Dẹp Local Cache (Auto Cleanup Local Storage)

Status: done

## Story

As a Background Worker,
I want to tự động xóa file MP4 khỏi local disk sau khi video đã được đăng lên Facebook thành công,
so that disk không bị đầy theo thời gian và chi phí lưu trữ được kiểm soát.

## Bối Cảnh & Lý Do

### Phụ thuộc
- **Story 8.1 nên hoàn thành trước** — cần `get_storage()` factory và `StorageBackend` Protocol
- Nếu Story 8.1 chưa implement: Story 8.2 vẫn hoạt động với `LocalStorage` (chỉ xóa local files)

### Vấn đề cần giải quyết
- `cron.py` hiện tại XÓA file ngay sau khi post thành công (inline cleanup — dòng 123-133)
- Tuy nhiên: `retry_video_download()` có thể vẫn cần file đó nếu retry fails → race condition
- Không có cơ chế dọn dẹp cho videos đã post nhưng file vẫn còn do lỗi không xóa được
- Videos `failed` lâu ngày vẫn chiếm disk (file downloaded nhưng upload FB fail)
- Nếu dùng S3 backend (Story 8.1): cần cleanup S3 objects để không tốn storage cost

### Scope Story 8.2
- APScheduler cron job mỗi 6 giờ
- Query videos đã `posted` > 24h mà `file_path` vẫn còn (`IS NOT NULL`)
- Xóa file qua `storage.delete()` (hoạt động với cả local + S3)
- Set `file_path = NULL` sau khi xóa
- **KHÔNG** xóa nếu video đang trong active retry (check `TaskQueue`)

## Acceptance Criteria

### AC1: Cleanup cron job — xóa files của posted videos
**Given** `storage_cleanup_job` cron chạy mỗi 6 giờ
**When** trigger
**Then** query:
```sql
SELECT * FROM videos
WHERE status = 'posted'
  AND file_path IS NOT NULL
  AND publish_time < NOW() - INTERVAL '24 hours'
```
**And** với mỗi video: gọi `storage.delete(file_path)` → set `file_path = NULL` → commit
**And** ghi 1 summary event: `SystemEvent(scope="cleanup", level="info", message="Đã dọn dẹp X file video")`
**And** nếu 0 files cần xóa → KHÔNG ghi event (tránh spam log)

### AC2: An toàn — không xóa file đang trong retry queue
**Given** video `posted` có `file_path` không null
**When** cleanup job check
**Then** nếu tồn tại `TaskQueue` record với `entity_id = video.id` AND `status IN (queued, processing)` → **SKIP** video đó
**And** log debug: "Skip video {id} — đang trong retry queue"

### AC3: Dọn dẹp files của failed videos lâu ngày (optional, configurable)
**Given** config `CLEANUP_FAILED_VIDEO_DAYS > 0` (default 7)
**When** cleanup job chạy
**Then** THÊM query: videos `failed` có `file_path IS NOT NULL` và `updated_at < NOW() - INTERVAL '{CLEANUP_FAILED_VIDEO_DAYS} days'`
**And** xóa files tương tự AC1
**And** KHÔNG thay đổi status (vẫn `failed`) — chỉ xóa file, set `file_path = NULL`
**And** nếu `CLEANUP_FAILED_VIDEO_DAYS = 0` → KHÔNG cleanup failed videos

### AC4: Registered trong APScheduler
**Given** `start_scheduler()` trong `cron.py`
**When** scheduler khởi động
**Then** `storage_cleanup_job` được đăng ký với `interval hours=6`, `id="storage_cleanup_job"`, `max_instances=1`, `coalesce=True`
**And** first run sau 10 phút từ lúc startup (tránh chạy ngay khi app vừa khởi động)

### AC5: Storage-agnostic — hoạt động với cả Local và S3
**Given** `STORAGE_BACKEND=local` hoặc `s3`
**When** cleanup job xóa file
**Then** dùng `storage.delete(file_path)` — hoạt động với cả hai backend
**And** nếu file không tồn tại (đã xóa trước đó) → set `file_path = NULL` anyway, không raise error

## Tasks / Subtasks

- [x] Task 1: Implement `storage_cleanup_job` function (AC: #1, #2, #3, #5)
  - [x] 1.1: Tạo function `storage_cleanup_job()` trong `cron.py`
  - [x] 1.2: Query posted videos với `file_path IS NOT NULL AND publish_time < now - 24h`
  - [x] 1.3: Check retry queue trước khi xóa — skip nếu active task
  - [x] 1.4: Gọi `storage.delete()` + set `file_path = NULL` + commit
  - [x] 1.5: Thêm optional cleanup cho failed videos theo `CLEANUP_FAILED_VIDEO_DAYS`
  - [x] 1.6: Ghi summary event chỉ khi `cleaned_count > 0`

- [x] Task 2: Đăng ký job trong APScheduler (AC: #4)
  - [x] 2.1: Thêm `storage_cleanup_job` vào `start_scheduler()` với `hours=6`, `next_run_time = now + 10min`
  - [x] 2.2: Follow pattern hiện tại: `if not scheduler.get_job("storage_cleanup_job"): scheduler.add_job(...)`

- [x] Task 3: Config vars (AC: #3)
  - [x] 3.1: Thêm `CLEANUP_FAILED_VIDEO_DAYS: int = 7` vào `Settings` class trong `config.py`
  - [x] 3.2: Thêm vào `.env.example`

- [x] Task 4: Unit tests (AC: #1-5)
  - [x] 4.1: Test cleanup posted videos > 24h — files deleted, file_path set to NULL
  - [x] 4.2: Test skip video đang trong active retry queue
  - [x] 4.3: Test posted videos < 24h — KHÔNG xóa
  - [x] 4.4: Test cleanup failed videos — khi CLEANUP_FAILED_VIDEO_DAYS=7, file deleted
  - [x] 4.5: Test CLEANUP_FAILED_VIDEO_DAYS=0 — failed videos KHÔNG bị xóa
  - [x] 4.6: Test file đã không còn tồn tại — set file_path=NULL anyway, no error
  - [x] 4.7: Test 0 files → KHÔNG ghi SystemEvent

### Review Findings (2026-05-02)

- [x] [Review][Patch] Rủi ro tệp mồ côi (Orphan Files) trên S3 — Đã sửa: Chỉ xóa tham chiếu DB sau khi storage delete thành công.
- [x] [Review][Patch] Rủi ro OOM trong job dọn dẹp — Đã thêm .limit(100) cho mỗi lần quét.
- [x] [Review][Patch] Sử dụng datetime.utcnow() bị deprecated — Đã chuyển sang datetime.now(timezone.utc).
- [x] [Review][Defer] Nghẽn I/O (Synchronous Blocking) khi dọn dẹp — chấp nhận cho quy mô hiện tại, cân nhắc ThreadPool sau. [backend/app/worker/cron.py:270] — deferred, minor priority

### Review Findings — Round 2 (2026-05-02)

**Critical**

- [x] [Review][Patch] **`NameError: timedelta` trong `start_scheduler()`** — `timedelta` chỉ được import cục bộ trong `storage_cleanup_job()` (line 251), nhưng `start_scheduler()` line 459 dùng `timedelta(minutes=10)` ở scope khác → worker process **CRASH** khi khởi động (toàn bộ scheduler không start). Empirically confirmed bằng cách gọi `start_scheduler()`. [backend/app/worker/cron.py:6,459]

**High**

- [x] [Review][Patch] `storage.delete()` trả `False` (file đã không còn) vẫn `cleaned_count += 1` và set `file_path=None` — không phân biệt xóa thật vs no-op. Check `if storage.delete(...): increment` tách ra. [backend/app/worker/cron.py:287-291,308-313]
- [x] [Review][Patch] `storage_cleanup_job` chỉ commit MỘT lần ở cuối → nếu vòng "failed videos" raise sau khi vòng "posted" đã `storage.delete()` thực tế xong, `db.rollback()` huỷ luôn việc set `file_path=None` cho posted videos → orphan ngược (file đã mất, DB còn path). Commit từng nhóm. [backend/app/worker/cron.py:255-315]
- [x] [Review][Patch] `.limit(100)` không có `ORDER BY` → DB có thể trả 100 hàng tuỳ ý, video cũ nhất bị starve không dọn được trong DB lớn. Thêm `order_by(Video.publish_time.asc())` cho posted, `order_by(Video.updated_at.asc())` cho failed. [backend/app/worker/cron.py:262-271,295-308]
- [x] [Review][Patch] `db.refresh(vid)` trong post-success path của `auto_post_job` có thể raise `ObjectDeletedError` nếu video bị xóa concurrent → file storage đã mất, DB không update → orphan ngược. Wrap try/except và log warning. [backend/app/worker/cron.py:201-208]
- [x] [Review][Patch] **Test coverage gap nghiêm trọng** — Story đánh dấu Task 4.1-4.7 là `[x]` nhưng `test_storage_cleanup.py` chỉ có 2 test (integrated + disabled). Thiếu test isolated cho 4.2 (skip retry queue), 4.3 (<24h skip), 4.6 (file đã không tồn tại), 4.7 (0 files → no event). Hơn nữa `patch("app.services.observability.record_event")` patch SAI module — phải là `app.worker.cron.record_event` vì cron.py đã `from ... import record_event` trực tiếp. Mock này không assert nên test pass vacuously. [backend/tests/test_storage_cleanup.py]

**Medium**

- [x] [Review][Patch] Posted videos có `publish_time IS NULL` không bao giờ được cleanup — SQL `publish_time < cutoff` trả NULL/false. Thêm clause `OR publish_time < cutoff` không work; đúng hơn là filter `publish_time.isnot(None)` riêng và xử lý null như "đã đủ tuổi" (set cutoff bằng updated_at fallback). [backend/app/worker/cron.py:267]
- [x] [Review][Patch] `file_path = ""` (empty string) bypass `Video.file_path.isnot(None)` — `storage.delete("")` không xác định, exception bị nuốt nhưng `file_path` vẫn empty → reprocess mỗi 6h. Filter `Video.file_path != ""`. [backend/app/worker/cron.py:266,301]
- [x] [Review][Patch] TaskQueue filter chặn cleanup khi có BẤT KỲ task nào với `entity_id == video.id`, không filter `task_type` — nếu trong tương lai có task khác (ví dụ thumbnail-gen) trùng entity_id, sẽ block cleanup không cần thiết. Thêm `TaskQueue.task_type.in_(["retry_video_download", "retry"])` hoặc whitelist rõ ràng. [backend/app/worker/cron.py:275-282]
- [x] [Review][Patch] `db.commit()` fail giữa `storage.delete` thành công và set `file_path=None` trong `auto_post_job` post-success → orphan ngược (file đã xóa S3 nhưng DB vẫn ghi path). Wrap commit thứ hai trong try/except, ghi warning event để cleanup_job xử lý sau. [backend/app/worker/cron.py:201-211]

**Low**

- [x] [Review][Patch] `test_storage_cleanup.py` mutation `settings.CLEANUP_FAILED_VIDEO_DAYS = 7` không restore → leak state sang test khác; dùng `monkeypatch.setattr` hoặc fixture restore. [backend/tests/test_storage_cleanup.py:88,121]
- [x] [Review][Patch] AC1 nói "0 files → KHÔNG ghi event" để tránh log spam, nhưng kèm theo đó cũng không có observability nào xác nhận job đã chạy → operator không phân biệt "chạy thành công, không có gì dọn" vs "job stuck/never-fire". Thêm `logger.info(f"storage_cleanup_job done, cleaned={cleaned_count}")` (debug-level log, không tốn DB event). [backend/app/worker/cron.py:317-325]

**Defer**

- [x] [Review][Defer] Multi-pod distributed lock cho `storage_cleanup_job` — `max_instances=1` của APScheduler chỉ áp dụng trong-process. Deferred — hiện chỉ chạy single worker pod, reconsider khi scale horizontally.
- [x] [Review][Defer] `record_event` sau `db.rollback()` trong cleanup error handler — risk thấp (record_event tự quản lý session); deferred.
- [x] [Review][Defer] `traceback.format_exc()` có thể vượt JSON column size limit — risk thấp (JSONB không giới hạn thực tế); deferred.
- [x] [Review][Defer] Async / `run_in_executor` cho `storage.delete` trong cleanup — đã defer Round 1, vẫn deferred.

**Dismissed (noise/false positive)**

- ❌ TaskQueue.entity_id UUID type mismatch — FALSE: model định nghĩa `entity_id = Column(String, ...)`.
- ❌ Naive datetime vs TIMESTAMPTZ mismatch — FALSE: `Video.publish_time = Column(DateTime, ...)` là naive.
- ❌ `replace_existing=True` thừa khi đã `if not get_job(...)` — harmless, không phải bug.
- ❌ Boundary `<` vs `<=` cho cutoff 24h — chấp nhận, off-by-vài-phút không quan trọng với chu kỳ 6h.
- ❌ Settings TOCTOU `CLEANUP_FAILED_VIDEO_DAYS` đọc 2 lần — race extreme, không đáng patch.

## Dev Notes

### Existing Cleanup Pattern — Cẩn thận!

`cron.py` dòng 123-133 **đã có** inline cleanup sau post:
```python
if vid.file_path and os.path.exists(vid.file_path):
    try:
        os.remove(vid.file_path)
    except Exception as exc:
        record_event("video", "warning", "Không thể xóa tệp tạm sau khi đăng.", ...)
```

Story 8.2 là **safety net** cho các trường hợp:
- Inline cleanup failed (exception)
- Story 8.1 dùng S3 → `file_path = s3://...` → `os.remove()` sẽ fail → cần cleanup job
- Videos từ trước khi Story 8.1 implement vẫn có local files

**KHÔNG xóa inline cleanup** trong `cron.py` khi implement Story 8.2. Cả hai hoạt động song song.
Sau Story 8.1 implement: inline cleanup xóa bằng `storage.delete()` — job chỉ xử lý còn sót.

### storage_cleanup_job Implementation

```python
def storage_cleanup_job():
    from datetime import timedelta
    from app.models.models import TaskQueue, TaskStatus
    from app.services.storage_backend import get_storage

    db: Session = SessionLocal()
    storage = get_storage()
    cleaned_count = 0

    try:
        cutoff = datetime.utcnow() - timedelta(hours=24)

        # Query posted videos với file_path còn tồn tại
        videos = db.query(Video).filter(
            Video.status == VideoStatus.posted,
            Video.file_path.isnot(None),
            Video.publish_time < cutoff,
        ).all()

        for video in videos:
            # Skip nếu đang trong active retry
            active_task = db.query(TaskQueue).filter(
                TaskQueue.entity_id == str(video.id),
                TaskQueue.status.in_([TaskStatus.queued, TaskStatus.processing]),
            ).first()
            if active_task:
                continue

            # Xóa file
            storage.delete(video.file_path)  # OK nếu file đã không còn
            video.file_path = None
            cleaned_count += 1

        # Optional: cleanup failed videos lâu ngày
        if settings.CLEANUP_FAILED_VIDEO_DAYS > 0:
            failed_cutoff = datetime.utcnow() - timedelta(days=settings.CLEANUP_FAILED_VIDEO_DAYS)
            failed_videos = db.query(Video).filter(
                Video.status == VideoStatus.failed,
                Video.file_path.isnot(None),
                Video.updated_at < failed_cutoff,
            ).all()
            for video in failed_videos:
                storage.delete(video.file_path)
                video.file_path = None
                cleaned_count += 1

        db.commit()

        if cleaned_count > 0:
            record_event("cleanup", "info",
                f"Đã dọn dẹp {cleaned_count} file video.", db=db,
                details={"cleaned_count": cleaned_count})

    except Exception as exc:
        record_event("cleanup", "error", "Tác vụ dọn dẹp file gặp lỗi.", db=db,
            details={"error": str(exc)})
    finally:
        db.close()
```

### APScheduler Registration Pattern

```python
# Trong start_scheduler() — thêm sau heartbeat_job block:
if not scheduler.get_job("storage_cleanup_job"):
    scheduler.add_job(
        storage_cleanup_job,
        "interval",
        id="storage_cleanup_job",
        hours=6,
        replace_existing=True,
        max_instances=1,
        coalesce=True,
        next_run_time=datetime.utcnow() + timedelta(minutes=10),
    )
```

### Xử lý `file_path IS NOT NULL` trong SQLAlchemy

```python
# SQLAlchemy filter cho IS NOT NULL:
Video.file_path.isnot(None)

# KHÔNG dùng:
Video.file_path != None  # WARNING: Python == comparison, không đúng
```

### Config thêm vào Settings

```python
CLEANUP_FAILED_VIDEO_DAYS: int = int(os.getenv("CLEANUP_FAILED_VIDEO_DAYS", "7"))
```

### Project Structure Notes

**Files sửa:**
- `backend/app/worker/cron.py` — Thêm `storage_cleanup_job()` function + đăng ký trong `start_scheduler()`
- `backend/app/core/config.py` — Thêm `CLEANUP_FAILED_VIDEO_DAYS`

**Files mới:**
- `backend/tests/test_storage_cleanup.py` — Unit tests

**KHÔNG SỬA:**
- `storage_backend.py` — Story 8.1 đã tạo, dùng lại qua `get_storage()`
- `models.py` — KHÔNG cần migration (`file_path` đã nullable từ Phase 1: `nullable=True` line 75)
- `campaigns.py`, `facebook.py`, `App.jsx` — không liên quan

### Edge Cases & Error Handling

1. **`file_path = NULL` đã null rồi:** Query filter `Video.file_path.isnot(None)` nên không xảy ra, nhưng nếu có thì `storage.delete(None)` → `LocalStorage.delete(None)` → check `if path and os.path.exists(path)` → skip safely
2. **File đã xóa trước đó (inline cleanup worked):** `storage.delete()` trả `False` (file không tồn tại), nhưng vẫn set `file_path = NULL` → consistent state
3. **S3 delete fail (network error):** Catch exception, log warning, KHÔNG set `file_path = NULL` → next cleanup run sẽ retry
4. **Large volume (1000+ videos):** Query không paginate → OK cho typical use case. Nếu cần scale → batch với `LIMIT 500`
5. **Cron chạy khi app restart:** `next_run_time = now + 10min` tránh cleanup ngay sau restart (ưu tiên serve traffic trước)
6. **`publish_time = NULL`:** Videos `posted` bình thường có `publish_time` — nhưng filter `publish_time < cutoff` sẽ skip NULL values (NULL comparison in SQL returns NULL/false)

### Anti-Patterns to Avoid

- **KHÔNG** xóa inline cleanup pattern trong `cron.py` (dòng 123-133) — giữ nguyên, cleanup job là safety net
- **KHÔNG** batch delete via raw SQL — dùng ORM để đảm bảo `file_path = NULL` được set đúng
- **KHÔNG** ghi event cho từng file xóa — chỉ summary cuối job
- **KHÔNG** dùng `Video.status == "posted"` (string) — dùng `VideoStatus.posted` (enum)
- **KHÔNG** set `CLEANUP_INTERVAL_HOURS` làm config — 6h là hardcoded hợp lý, over-configurable

### References

- [Source: architecture.md#D3: Storage Abstraction Architecture — Cleanup Job]
- [Source: epics.md#Epic 8, Story 8.2]
- [Source: Story 8.1 — 8-1-tich-hop-cloud-object-storage.md — get_storage(), StorageBackend Protocol]
- [Source: backend/app/worker/cron.py — start_scheduler() pattern, inline cleanup dòng 123-133]
- [Source: backend/app/models/models.py — Video.file_path (nullable=True, line 75), TaskQueue model]
- [Source: backend/app/core/config.py — Settings class pattern]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### Change Log

### File List

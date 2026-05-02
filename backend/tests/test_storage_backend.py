import os
import tempfile
import pytest
from unittest.mock import MagicMock, patch

from app.services.storage_backend import (
    LocalStorage,
    S3Storage,
    _sanitize_filename,
    build_s3_key,
    get_storage,
    reset_storage_cache,
)


# ---------------------------------------------------------------------------
# build_s3_key / _sanitize_filename
# ---------------------------------------------------------------------------


def test_build_s3_key():
    local_path = "/tmp/video_123.mp4"
    key = build_s3_key(local_path)
    assert key.startswith("videos/")
    assert key.endswith("_video_123.mp4")
    parts = key.split("/")
    assert len(parts) == 4
    filename_part = parts[3]
    assert len(filename_part.split("_")[0]) == 8  # unique_id


def test_build_s3_key_sanitizes_unsafe_chars():
    key = build_s3_key("/tmp/some video?#with spaces.mp4")
    assert " " not in key
    assert "?" not in key
    assert "#" not in key
    assert key.endswith(".mp4")


def test_sanitize_filename_handles_empty():
    assert _sanitize_filename("") == "video"
    assert _sanitize_filename(".....") == "video"


def test_sanitize_filename_truncates_long_names():
    name = "a" * 500 + ".mp4"
    out = _sanitize_filename(name)
    assert len(out) <= 200
    assert out.endswith(".mp4")


# ---------------------------------------------------------------------------
# LocalStorage
# ---------------------------------------------------------------------------


def test_local_storage_save_is_no_op():
    storage = LocalStorage()
    assert storage.save("/tmp/abc.mp4", "videos/x") == "/tmp/abc.mp4"


def test_local_storage_exists(tmp_path):
    storage = LocalStorage()
    test_file = tmp_path / "test.txt"
    test_file.write_text("hello")
    assert storage.exists(str(test_file)) is True
    assert storage.exists("/non/existent/path") is False


def test_local_storage_delete(tmp_path):
    storage = LocalStorage()
    test_file = tmp_path / "test_del.txt"
    test_file.write_text("hello")
    assert os.path.exists(test_file)
    assert storage.delete(str(test_file)) is True
    assert not os.path.exists(test_file)


def test_local_storage_delete_returns_false_for_missing():
    storage = LocalStorage()
    assert storage.delete("/non/existent/file.mp4") is False


def test_local_storage_get_local_copy_is_no_op():
    storage = LocalStorage()
    path = "/some/path/video.mp4"
    assert storage.get_local_copy(path) == path


def test_local_storage_does_not_require_temp_copy():
    assert LocalStorage().requires_temp_copy() is False


# ---------------------------------------------------------------------------
# S3Storage
# ---------------------------------------------------------------------------


def _make_s3(mock_boto):
    mock_client = MagicMock()
    mock_boto.return_value = mock_client
    storage = S3Storage("test-bucket", "us-east-1", "key", "secret")
    return storage, mock_client


@patch("boto3.client")
def test_s3_storage_save(mock_boto):
    storage, mock_client = _make_s3(mock_boto)
    local_path = "/tmp/test.mp4"
    remote_key = "videos/2026/05/test.mp4"
    result = storage.save(local_path, remote_key)
    assert result == f"s3://test-bucket/{remote_key}"
    mock_client.upload_file.assert_called_once_with(local_path, "test-bucket", remote_key)


@patch("boto3.client")
def test_s3_storage_exists_true(mock_boto):
    storage, mock_client = _make_s3(mock_boto)
    mock_client.head_object.return_value = {}
    assert storage.exists("s3://test-bucket/videos/test.mp4") is True
    mock_client.head_object.assert_called_with(Bucket="test-bucket", Key="videos/test.mp4")


@patch("boto3.client")
def test_s3_storage_exists_404_returns_false(mock_boto):
    from botocore.exceptions import ClientError

    storage, mock_client = _make_s3(mock_boto)
    mock_client.head_object.side_effect = ClientError(
        {"Error": {"Code": "404"}, "ResponseMetadata": {"HTTPStatusCode": 404}},
        "HeadObject",
    )
    assert storage.exists("s3://test-bucket/videos/nope.mp4") is False


@patch("boto3.client")
def test_s3_storage_exists_raises_on_non_404(mock_boto):
    from botocore.exceptions import ClientError

    storage, mock_client = _make_s3(mock_boto)
    mock_client.head_object.side_effect = ClientError(
        {"Error": {"Code": "403"}, "ResponseMetadata": {"HTTPStatusCode": 403}},
        "HeadObject",
    )
    with pytest.raises(ClientError):
        storage.exists("s3://test-bucket/videos/forbidden.mp4")


@patch("boto3.client")
def test_s3_storage_exists_invalid_path_returns_false(mock_boto):
    storage, _ = _make_s3(mock_boto)
    assert storage.exists("s3://other-bucket/foo.mp4") is False


@patch("boto3.client")
def test_s3_storage_delete_success(mock_boto):
    storage, mock_client = _make_s3(mock_boto)
    assert storage.delete("s3://test-bucket/videos/x.mp4") is True
    mock_client.delete_object.assert_called_with(Bucket="test-bucket", Key="videos/x.mp4")


@patch("boto3.client")
def test_s3_storage_delete_invalid_path_returns_false(mock_boto):
    storage, mock_client = _make_s3(mock_boto)
    assert storage.delete("s3://wrong-bucket/key") is False
    mock_client.delete_object.assert_not_called()


@patch("boto3.client")
def test_s3_storage_delete_client_error_returns_false(mock_boto):
    from botocore.exceptions import ClientError

    storage, mock_client = _make_s3(mock_boto)
    mock_client.delete_object.side_effect = ClientError(
        {"Error": {"Code": "AccessDenied"}}, "DeleteObject"
    )
    assert storage.delete("s3://test-bucket/videos/x.mp4") is False


@patch("boto3.client")
def test_s3_storage_get_local_copy_success(mock_boto, tmp_path):
    storage, mock_client = _make_s3(mock_boto)

    def fake_download(bucket, key, dest):
        with open(dest, "wb") as f:
            f.write(b"bytes")

    mock_client.download_file.side_effect = fake_download
    local = storage.get_local_copy("s3://test-bucket/videos/x.mp4")
    try:
        assert os.path.exists(local)
        assert os.path.basename(local).startswith("s3_dl_")
    finally:
        if os.path.exists(local):
            os.remove(local)


@patch("boto3.client")
def test_s3_storage_get_local_copy_cleans_partial_on_failure(mock_boto):
    storage, mock_client = _make_s3(mock_boto)
    captured = {}

    def fake_download(bucket, key, dest):
        # Simulate boto3 creating a partial file then failing.
        with open(dest, "wb") as f:
            f.write(b"partial")
        captured["dest"] = dest
        raise OSError("disk full mid-download")

    mock_client.download_file.side_effect = fake_download
    with pytest.raises(RuntimeError, match="Không thể lấy bản sao local"):
        storage.get_local_copy("s3://test-bucket/videos/x.mp4")
    assert "dest" in captured
    assert not os.path.exists(captured["dest"])


@patch("boto3.client")
def test_s3_storage_requires_temp_copy(mock_boto):
    storage, _ = _make_s3(mock_boto)
    assert storage.requires_temp_copy() is True


@patch("boto3.client")
def test_s3_parse_key_rejects_wrong_bucket(mock_boto):
    storage, _ = _make_s3(mock_boto)
    with pytest.raises(ValueError):
        storage._parse_key("s3://other-bucket/videos/x.mp4")


# ---------------------------------------------------------------------------
# Factory: get_storage / validation / cache
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_cache():
    reset_storage_cache()
    yield
    reset_storage_cache()


@patch("app.services.storage_backend.settings")
def test_get_storage_returns_local(mock_settings):
    mock_settings.STORAGE_BACKEND = "local"
    storage = get_storage()
    assert isinstance(storage, LocalStorage)


@patch("app.services.storage_backend.settings")
def test_get_storage_returns_s3(mock_settings):
    mock_settings.STORAGE_BACKEND = "s3"
    mock_settings.S3_BUCKET = "my-bucket"
    mock_settings.S3_REGION = "us-east-1"
    mock_settings.S3_ACCESS_KEY = "key"
    mock_settings.S3_SECRET_KEY = "secret"
    mock_settings.S3_ENDPOINT_URL = ""
    with patch("boto3.client"):
        storage = get_storage()
        assert isinstance(storage, S3Storage)
        assert storage._bucket == "my-bucket"


@patch("app.services.storage_backend.settings")
def test_get_storage_normalizes_case_and_whitespace(mock_settings):
    mock_settings.STORAGE_BACKEND = "  S3  "
    mock_settings.S3_BUCKET = "b"
    mock_settings.S3_REGION = "us-east-1"
    mock_settings.S3_ACCESS_KEY = "k"
    mock_settings.S3_SECRET_KEY = "s"
    mock_settings.S3_ENDPOINT_URL = ""
    with patch("boto3.client"):
        storage = get_storage()
        assert isinstance(storage, S3Storage)


@patch("app.services.storage_backend.settings")
def test_get_storage_rejects_invalid_backend(mock_settings):
    mock_settings.STORAGE_BACKEND = "azure"
    with pytest.raises(ValueError, match="STORAGE_BACKEND không hợp lệ"):
        get_storage()


@patch("app.services.storage_backend.settings")
def test_get_storage_requires_bucket_for_s3(mock_settings):
    mock_settings.STORAGE_BACKEND = "s3"
    mock_settings.S3_BUCKET = ""
    with pytest.raises(ValueError, match="S3_BUCKET"):
        get_storage()


@patch("app.services.storage_backend.settings")
def test_get_storage_caches_instance(mock_settings):
    mock_settings.STORAGE_BACKEND = "local"
    a = get_storage()
    b = get_storage()
    assert a is b


# ---------------------------------------------------------------------------
# Integration smoke (mock storage, no real network)
# ---------------------------------------------------------------------------


def test_storage_integration_download_flow():
    mock_storage = MagicMock()
    local_path = "/tmp/test_download.mp4"
    remote_path = "s3://bucket/videos/2026/05/test_download.mp4"
    mock_storage.save.return_value = remote_path
    out_path = local_path
    s3_key = build_s3_key(out_path)
    stored_path = mock_storage.save(out_path, s3_key)
    assert stored_path == remote_path
    mock_storage.save.assert_called_once_with(out_path, s3_key)


def test_storage_integration_posting_flow():
    mock_storage = MagicMock()
    stored_path = "s3://bucket/videos/test.mp4"
    local_copy = "/tmp/local_copy.mp4"
    mock_storage.exists.return_value = True
    mock_storage.get_local_copy.return_value = local_copy
    mock_storage.requires_temp_copy.return_value = True
    assert mock_storage.exists(stored_path) is True
    path_for_upload = mock_storage.get_local_copy(stored_path)
    is_temp = mock_storage.requires_temp_copy()
    assert path_for_upload == local_copy
    assert is_temp is True
    mock_storage.delete(stored_path)
    mock_storage.delete.assert_called_once_with(stored_path)

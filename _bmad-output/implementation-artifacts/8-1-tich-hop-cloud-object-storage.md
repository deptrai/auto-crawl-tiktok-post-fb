# Story 8.1: Tích Hợp Cloud Object Storage (Cloud Storage Integration)

Status: done

## Story

As a Background Worker,
I want to lưu video MP4 đã tải vào S3-compatible object storage thay vì local filesystem,
so that video không bị mất khi container restart hoặc disk đầy.

## Bối Cảnh & Lý Do

### Phụ thuộc
- **KHÔNG có phụ thuộc cứng** — Story này có thể implement độc lập
- Epic 7 (Token), Epic 9 (Filter) không liên quan

### Vấn đề cần giải quyết
- Video MP4 lưu local `/app/downloads/` → **mất khi container restart** (stateless container)
- Disk local giới hạn → sau vài tuần tích lũy, disk đầy → upload fail
- Không thể scale horizontally (nhiều worker nodes không share local disk)

### Phạm vi Story 8.1
Story này implement:
1. **Strategy Pattern** cho storage — `StorageBackend` Protocol, `LocalStorage`, `S3Storage`
2. **Download → S3 flow**: sau download xong → upload S3 → xóa local temp → lưu S3 path vào DB
3. **Posting flow update**: khi post lên FB, nếu `file_path` là S3 → download temp → post → xóa temp
4. **Backward compatible**: `STORAGE_BACKEND=local` (default) giữ nguyên toàn bộ behavior Phase 1

Story 8.2 (Auto Cleanup cron job) là scope riêng biệt.

### Integration Points Quan Trọng

**Sau download** (`campaign_jobs.py` dòng ~198):
```python
out_path, _ = download_video(download_url, "tiktok")
if out_path:
    db_video.file_path = out_path  # ← cần thay bằng storage.save()
```

**Khi post lên Facebook** (`cron.py` dòng ~91-125):
```python
if not vid.file_path or not os.path.exists(vid.file_path):  # ← cần handle S3 path
    ...
res = upload_video_to_facebook(file_path=vid.file_path, ...)  # ← cần local file
if os.path.exists(vid.file_path):
    os.remove(vid.file_path)  # ← cần storage.delete()
```

## Acceptance Criteria

### AC1: StorageBackend abstraction layer
**Given** `storage_backend.py` được tạo
**When** hệ thống khởi động
**Then** `StorageBackend` Protocol với 4 methods:
- `save(local_path: str, remote_key: str) -> str` — lưu file, trả về stored path/URL
- `delete(stored_path: str) -> bool` — xóa file
- `exists(stored_path: str) -> bool` — kiểm tra file tồn tại
- `get_local_copy(stored_path: str) -> str` — trả về local path (copy tạm nếu S3)
**And** `LocalStorage` implement Protocol — wraps existing `os.path.*` operations
**And** `S3Storage` implement Protocol — dùng `boto3`
**And** `get_storage() -> StorageBackend` factory function — đọc `settings.STORAGE_BACKEND`

### AC2: Config vars cho S3
**Given** `settings.py` có config mới
**When** `STORAGE_BACKEND=s3`
**Then** các vars sau được đọc từ env:
- `STORAGE_BACKEND`: "local" | "s3" (default "local")
- `S3_BUCKET`: tên bucket (required khi backend=s3)
- `S3_REGION`: AWS region (default "us-east-1")
- `S3_ACCESS_KEY`: AWS access key
- `S3_SECRET_KEY`: AWS secret key
- `S3_ENDPOINT_URL`: custom endpoint cho R2/MinIO (optional, empty = dùng AWS)
**And** `boto3>=1.34.0` được thêm vào `requirements.txt`

### AC3: Download flow dùng storage backend
**Given** `STORAGE_BACKEND=s3` và S3 đã cấu hình
**When** `sync_campaign_content()` download video thành công
**Then** sau khi `download_video()` trả về `out_path` (local temp):
1. Gọi `storage.save(out_path, key)` với `key = "videos/{YYYY}/{MM}/{filename}"`
2. Xóa local temp file sau khi S3 upload thành công
3. Lưu S3 path (`s3://bucket/videos/2026/04/tiktok_xxx.mp4`) vào `db_video.file_path`
**And** nếu S3 upload fail → giữ local path, log warning, tiếp tục (graceful fallback)
**And** `STORAGE_BACKEND=local` → không thay đổi gì so với hiện tại

### AC4: Posting flow xử lý S3 path
**Given** `vid.file_path` là S3 path (`s3://...`)
**When** `auto_post_job` chuẩn bị upload lên Facebook
**Then**:
1. `storage.exists(vid.file_path)` thay vì `os.path.exists()`
2. `local_path = storage.get_local_copy(vid.file_path)` → download S3 → temp file
3. `upload_video_to_facebook(file_path=local_path, ...)`
4. Sau upload xong → `storage.delete(vid.file_path)` (xóa S3), xóa temp local
5. Set `vid.file_path = None` sau khi đã post
**And** `STORAGE_BACKEND=local` → behavior giữ nguyên như Phase 1

### AC5: Backward compatibility — local storage không đổi
**Given** `STORAGE_BACKEND=local` (default)
**When** sync và post chạy
**Then** toàn bộ behavior GIỐNG HỆT Phase 1 — không có regression
**And** `file_path` vẫn là local path như cũ
**And** `LocalStorage.get_local_copy()` trả về chính `stored_path` (no-op)

## Tasks / Subtasks

- [x] Task 1: Tạo `storage_backend.py` với StorageBackend Protocol (AC: #1)
  - [x] 1.1: Implement `StorageBackend` Protocol (4 methods)
  - [x] 1.2: Implement `LocalStorage` — wrap `os.path.exists`, `os.remove`, `shutil.copy` (no-op)
  - [x] 1.3: Implement `S3Storage` — dùng `boto3.client("s3")`
  - [x] 1.4: Implement `get_storage()` factory function
  - [x] 1.5: `S3Storage.save()` — upload với `put_object` hoặc `upload_file`, trả `s3://bucket/key`
  - [x] 1.6: `S3Storage.exists()` — dùng `head_object` (try/except NoSuchKey)
  - [x] 1.7: `S3Storage.get_local_copy()` — download về `/tmp/storage_xxx.mp4`, trả local path
  - [x] 1.8: `S3Storage.delete()` — `delete_object`

- [x] Task 2: Config vars + requirements (AC: #2)
  - [x] 2.1: Thêm `STORAGE_BACKEND`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_ENDPOINT_URL` vào `Settings` class
  - [x] 2.2: Thêm `boto3>=1.34.0` vào `requirements.txt`
  - [x] 2.3: Thêm vars vào `.env.example`

- [x] Task 3: Mở rộng download flow (AC: #3)
  - [x] 3.1: Inject `get_storage()` vào `sync_campaign_content()` TRƯỚC loop
  - [x] 3.2: Sau `download_video()` trả `out_path` → gọi `storage.save()` → cập nhật `file_path`
  - [x] 3.3: Xóa local temp khi S3 save thành công
  - [x] 3.4: Graceful fallback: nếu S3 save fail → log warning, giữ local path

- [x] Task 4: Mở rộng posting flow (AC: #4)
  - [x] 4.1: Inject `get_storage()` vào `auto_post_job()` trong `cron.py` TRƯỚC loop
  - [x] 4.2: Thay `os.path.exists(file_path)` → `storage.exists(file_path)`
  - [x] 4.3: Gọi `storage.get_local_copy(file_path)` để lấy local path trước khi upload FB
  - [x] 4.4: Sau upload FB thành công → `storage.delete(file_path)` thay vì `os.remove()`
  - [x] 4.5: Cleanup temp local file sau khi FB upload (nếu S3 backend)

- [x] Task 5: Unit tests (AC: #1-5)
  - [x] 5.1: Test `LocalStorage` — save/exists/delete/get_local_copy với mock filesystem
  - [x] 5.2: Test `S3Storage` — mock boto3 client, test save/exists/delete/get_local_copy
  - [x] 5.3: Test `get_storage()` factory — STORAGE_BACKEND=local → LocalStorage, s3 → S3Storage
  - [x] 5.4: Test download flow — S3 save success → file_path updated, local temp deleted
  - [x] 5.5: Test download flow — S3 save fail → fallback to local path
  - [x] 5.6: Test posting flow — S3 path → get_local_copy → upload → delete S3 → delete temp

### Review Findings (2026-05-02)

- [x] [Review][Decision] Chiến lược dọn dẹp file tạm (/tmp) — đã giải quyết: thêm `finally` block xóa local_path khi `is_temp_copy`. [backend/app/worker/cron.py:155-161]
- [x] [Review][Patch] Race condition trong retry_video_download — fixed: save trước, delete old sau commit. [backend/app/services/campaign_jobs.py:86-102]
- [x] [Review][Patch] S3 Key Collision — fixed: thêm `unique_id = uuid4().hex[:8]` prefix vào filename. [backend/app/services/storage_backend.py:133-139]
- [x] [Review][Patch] Thiếu xử lý Disk Full khi download từ S3 — fixed Round 2: thêm try/finally cleanup `tmp_path` partial khi `download_file` raise. [backend/app/services/storage_backend.py:179-198]
- [x] [Review][Defer] Boto3 client có thể gây nghẽn I/O nếu không được bọc trong run_in_executor — deferred, app hiện tại đồng bộ (sync), chưa có asyncio path. Reconsider khi scale.
- [x] [Review][Patch] Parse S3 Key thiếu linh hoạt với bucket name chứa dấu chấm — fixed: dùng `startswith(prefix)` + `s3_path[len(prefix):]`. [backend/app/services/storage_backend.py:69-75]
- [x] [Review][Patch] Thiếu validation input cho S3_ENDPOINT_URL — fixed: strip + auto-prefix `https://`. [backend/app/services/storage_backend.py:118-121]
- [x] [Review][Defer] Logging format chưa thống nhất giữa các service. [backend/app/services/campaign_jobs.py:105] — deferred, pre-existing
- [x] [Review][Defer] Sử dụng utcnow() bị cảnh báo deprecated trong Python 3.12. [backend/app/services/storage_backend.py:122] — deferred, minor priority

### Review Findings — Round 2 (2026-05-02)

**Critical**

- [x] [Review][Patch] Race condition giữa `auto_post_job` và `retry_video_download` — auto_post xóa `vid.file_path` rồi `= None`, retry chạy đồng thời có thể đọc/xóa cùng object. Cần `db.refresh(vid)` + status guard (`vid.status != posted`) hoặc `SELECT ... FOR UPDATE SKIP LOCKED` trước khi delete. [backend/app/worker/cron.py:142-143]
- [x] [Review][Patch] `storage.delete` chạy TRƯỚC `db.commit()` trong auto_post — nếu commit DB fail sau khi đã xóa S3, video coi như chưa post nhưng file đã mất. Reorder: commit trước, sau đó mới delete storage; nếu delete fail thì log warning để janitor reconcile. [backend/app/worker/cron.py:142-143,163]
- [x] [Review][Patch] `sync_campaign_content` không cleanup S3 object khi DB commit fail sau `storage.save` — orphan object vĩnh viễn. Bọc save+commit trong try; rollback S3 (delete key vừa upload) nếu DB fail. [backend/app/services/campaign_jobs.py:262-285]
- [x] [Review][Patch] `retry_video_download` fallback xóa `video.file_path` cũ có thể xóa nhầm scheme khác (S3 path khi backend đã đổi sang local, hoặc ngược lại) — chỉ delete khi `out_path != video.file_path` và đảm bảo cùng scheme. [backend/app/services/campaign_jobs.py:120-123]

**High**

- [x] [Review][Patch] `auto_post_job` raise trong `get_local_copy` làm crash cả batch — wrap per-video logic trong try/except để mark single video failed và continue. [backend/app/worker/cron.py:118-163]
- [x] [Review][Patch] `S3Storage.exists` swallow MỌI exception → trả False khi network/auth lỗi → mark video failed sai. Phân biệt `ClientError 404/NoSuchKey` (return False) vs lỗi transient (raise). [backend/app/services/storage_backend.py:89-95]
- [x] [Review][Patch] `S3Storage.delete` swallow exception, không log → orphan object âm thầm. Log error trong except, phân biệt key-not-found (idempotent OK) với auth/network lỗi. [backend/app/services/storage_backend.py:81-87]
- [x] [Review][Patch] `get_local_copy` partial download không cleanup `tmp_path` khi `download_file` raise giữa chừng — wrap trong try/finally để `os.remove(tmp_path)` khi exception. [backend/app/services/storage_backend.py:97-109]
- [x] [Review][Patch] `_parse_key` fallback nguy hiểm với s3 path khác bucket — silently dùng wrong key. Raise `ValueError` khi prefix không match `s3://{self._bucket}/`. [backend/app/services/storage_backend.py:69-75]
- [x] [Review][Patch] Boto3 client thiếu `Config(retries=adaptive, connect_timeout, read_timeout)` — video lớn upload qua mạng chậm sẽ timeout default 60s, không retry. Truyền `botocore.config.Config(retries={"max_attempts": 5, "mode": "adaptive"}, connect_timeout=10, read_timeout=120)`. [backend/app/services/storage_backend.py:56-67]

**Medium**

- [x] [Review][Patch] `is_temp_copy = local_path != vid.file_path` — string compare fragile (relative vs absolute path). Đề xuất: thêm method `requires_temp_copy()` vào Protocol hoặc trả tuple `(local_path, is_temp)` từ `get_local_copy`. [backend/app/worker/cron.py:120-121] [backend/app/services/campaign_jobs.py:267]
- [x] [Review][Patch] `STORAGE_BACKEND` không validate — typo `"S3"`, `"local "` đều rơi về local mặc định, dữ liệu mong đợi vào S3 mất. Thêm `STORAGE_BACKEND.strip().lower()` và raise nếu không thuộc `{local, s3}`. [backend/app/services/storage_backend.py:114]
- [x] [Review][Patch] `datetime.utcnow()` deprecated Python 3.12 — replace bằng `datetime.now(timezone.utc)`. [backend/app/services/storage_backend.py:135]
- [x] [Review][Patch] `get_storage()` tạo S3Storage mới mỗi tick → boto3 client init lại, không reuse connection pool. Cache với `functools.lru_cache(maxsize=1)` hoặc module-level singleton. [backend/app/services/storage_backend.py:112-130]
- [x] [Review][Patch] Test coverage thiếu: không test `S3Storage.delete` (cả happy path lẫn raise), không test `S3Storage.get_local_copy` (download fail → RuntimeError, partial file cleanup), không integration test fallback path của `sync_campaign_content`/`retry_video_download` khi `storage.save` raise. Bổ sung 4-5 test mới. [backend/tests/test_storage_backend.py]

**Low**

- [x] [Review][Patch] `build_s3_key` không sanitize tên file — ký tự đặc biệt (space, unicode, `?`, `#`, `..`) làm S3 key invalid hoặc khó list/presigned URL. Slugify basename hoặc `urllib.parse.quote`. [backend/app/services/storage_backend.py:138-139]
- [x] [Review][Patch] `S3Storage.__init__` không có health check → credentials sai chỉ phát hiện khi save lần đầu. Thêm `head_bucket` optional + log warning hoặc raise. [backend/app/services/storage_backend.py:56-67]
- [x] [Review][Patch] Empty/0-byte `out_path` không được check trước `storage.save` — upload file rỗng tiêu retry quota. Guard `os.path.getsize(out_path) > 0`. [backend/app/services/campaign_jobs.py:262]

**Defer**

- [x] [Review][Defer] `boto3` async/run_in_executor — deferred, app sync hiện chưa có asyncio path; reconsider khi tích hợp FastAPI async endpoints chạm vào storage.
- [x] [Review][Defer] `/tmp` disk quota check khi nhiều worker download song song — deferred, infra/container concern, monitor qua observability.
- [x] [Review][Defer] Validate hostname/port của `S3_ENDPOINT_URL` — deferred, runtime check là đủ với cấu hình admin.
- [x] [Review][Defer] S3 secrets dùng plaintext env (không qua `decrypt_secret`) — deferred, convention khác với DB-stored token; chấp nhận cho infrastructure config.

**Dismissed (noise/false positive)**

- ❌ NameError `logger` chưa import trong cron.py — FALSE POSITIVE (defined at `cron.py:8`).
- ❌ Scope creep `record_event` thêm field `storage` — beneficial cho observability, không phải lỗi.
- ❌ Thiếu `test_local_storage_save` no-op — minor, đã cover gián tiếp qua factory test.
- ❌ Auto-prefix `https://` cho endpoint là scope creep — đã được duyệt trong patch #6 round 1.

## Dev Notes

### StorageBackend Implementation

```python
# backend/app/services/storage_backend.py
from __future__ import annotations
import os
import tempfile
import uuid
from datetime import datetime
from typing import Protocol

from app.core.config import settings


class StorageBackend(Protocol):
    def save(self, local_path: str, remote_key: str) -> str: ...
    def delete(self, stored_path: str) -> bool: ...
    def exists(self, stored_path: str) -> bool: ...
    def get_local_copy(self, stored_path: str) -> str: ...


class LocalStorage:
    """Strategy Pattern — local filesystem. Backward compatible với Phase 1."""

    def save(self, local_path: str, remote_key: str) -> str:
        return local_path  # no-op: file đã ở local

    def delete(self, stored_path: str) -> bool:
        try:
            if os.path.exists(stored_path):
                os.remove(stored_path)
                return True
        except OSError:
            pass
        return False

    def exists(self, stored_path: str) -> bool:
        return os.path.exists(stored_path)

    def get_local_copy(self, stored_path: str) -> str:
        return stored_path  # no-op: đã là local path


class S3Storage:
    """Strategy Pattern — S3-compatible storage (AWS S3, Cloudflare R2, MinIO)."""

    def __init__(self, bucket: str, region: str, access_key: str,
                 secret_key: str, endpoint_url: str | None = None):
        import boto3
        kwargs = dict(
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
        )
        if endpoint_url:
            kwargs["endpoint_url"] = endpoint_url
        self._client = boto3.client("s3", **kwargs)
        self._bucket = bucket

    def _parse_key(self, s3_path: str) -> str:
        """Parse s3://bucket/key → key."""
        return s3_path.replace(f"s3://{self._bucket}/", "", 1)

    def save(self, local_path: str, remote_key: str) -> str:
        self._client.upload_file(local_path, self._bucket, remote_key)
        return f"s3://{self._bucket}/{remote_key}"

    def delete(self, stored_path: str) -> bool:
        try:
            key = self._parse_key(stored_path)
            self._client.delete_object(Bucket=self._bucket, Key=key)
            return True
        except Exception:
            return False

    def exists(self, stored_path: str) -> bool:
        try:
            key = self._parse_key(stored_path)
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except Exception:
            return False

    def get_local_copy(self, stored_path: str) -> str:
        """Download S3 object về temp file, trả về local path."""
        key = self._parse_key(stored_path)
        filename = os.path.basename(key)
        tmp_path = os.path.join(tempfile.gettempdir(), f"s3_dl_{uuid.uuid4().hex}_{filename}")
        self._client.download_file(self._bucket, key, tmp_path)
        return tmp_path


def get_storage() -> LocalStorage | S3Storage:
    """Factory: trả StorageBackend dựa trên settings.STORAGE_BACKEND."""
    if settings.STORAGE_BACKEND == "s3":
        if not settings.S3_BUCKET:
            raise ValueError("S3_BUCKET chưa được cấu hình khi STORAGE_BACKEND=s3")
        return S3Storage(
            bucket=settings.S3_BUCKET,
            region=settings.S3_REGION,
            access_key=settings.S3_ACCESS_KEY,
            secret_key=settings.S3_SECRET_KEY,
            endpoint_url=settings.S3_ENDPOINT_URL or None,
        )
    return LocalStorage()
```

### S3 Key Convention

```python
# Key format: videos/{YYYY}/{MM}/{original_filename}
from datetime import datetime
import os

def build_s3_key(local_path: str) -> str:
    now = datetime.utcnow()
    filename = os.path.basename(local_path)
    return f"videos/{now.year}/{now.month:02d}/{filename}"
```

### Tích hợp vào campaign_jobs.py

```python
# TRƯỚC loop — khởi tạo storage một lần:
from app.services.storage_backend import get_storage, build_s3_key
storage = get_storage()

# SAU download_video() thành công:
out_path, _ = download_video(download_url, "tiktok")
if out_path:
    try:
        s3_key = build_s3_key(out_path)
        stored_path = storage.save(out_path, s3_key)
        if stored_path != out_path:  # S3 backend — xóa local temp
            safe_remove_file(out_path)
        db_video.file_path = stored_path
    except Exception as exc:
        # Graceful fallback: giữ local path nếu S3 fail
        record_event("storage", "warning", "S3 upload thất bại, giữ local.",
            db=db, details={"error": str(exc), "video_id": str(db_video.id)})
        db_video.file_path = out_path
    db_video.status = VideoStatus.ready
```

### Tích hợp vào cron.py

```python
# TRƯỚC page loop — khởi tạo storage một lần:
from app.services.storage_backend import get_storage
storage = get_storage()

# THAY THẾ os.path.exists check:
# TRƯỚC: if not vid.file_path or not os.path.exists(vid.file_path):
# SAU:
if not vid.file_path or not storage.exists(vid.file_path):
    vid.status = VideoStatus.failed
    vid.last_error = "Tệp video không tồn tại hoặc đã bị xóa."
    ...
    continue

# LẤY LOCAL PATH để upload FB:
local_path = storage.get_local_copy(vid.file_path)
is_temp_copy = local_path != vid.file_path  # True nếu S3 backend

res = upload_video_to_facebook(
    file_path=local_path,   # ← dùng local_path thay vì vid.file_path
    ...
)

if "id" in res:
    ...
    # XÓA FILE sau khi đã post thành công:
    storage.delete(vid.file_path)  # xóa S3 object
    if is_temp_copy and os.path.exists(local_path):
        os.remove(local_path)  # xóa local temp
    vid.file_path = None  # set null sau khi đã xóa
```

### QUAN TRỌNG — Temp file cleanup

Khi S3 backend, `get_local_copy()` tạo file trong `/tmp/`. Nếu upload FB fail sau khi đã get_local_copy:
- Temp file vẫn còn trong `/tmp/` → cần cleanup trong `finally` block hoặc catch exception
- Đây là edge case chấp nhận được cho MVP — `/tmp/` OS sẽ tự dọn theo thời gian

### Config vars trong Settings class

```python
# Thêm vào Settings class trong config.py:
STORAGE_BACKEND: str = os.getenv("STORAGE_BACKEND", "local")   # "local" | "s3"
S3_BUCKET: str = os.getenv("S3_BUCKET", "")
S3_REGION: str = os.getenv("S3_REGION", "us-east-1")
S3_ACCESS_KEY: str = os.getenv("S3_ACCESS_KEY", "")
S3_SECRET_KEY: str = os.getenv("S3_SECRET_KEY", "")
S3_ENDPOINT_URL: str = os.getenv("S3_ENDPOINT_URL", "")  # Cloudflare R2/MinIO
```

### S3-Compatible Services Support

- **AWS S3**: `S3_ENDPOINT_URL` = empty
- **Cloudflare R2**: `S3_ENDPOINT_URL = https://<account_id>.r2.cloudflarestorage.com`
- **MinIO**: `S3_ENDPOINT_URL = http://minio:9000`
- Cả ba dùng boto3 với S3 API, chỉ khác endpoint

### Project Structure Notes

**Files mới:**
- `backend/app/services/storage_backend.py` — StorageBackend Protocol + LocalStorage + S3Storage + factory
- `backend/tests/test_storage_backend.py` — Unit tests (mock boto3)

**Files sửa:**
- `backend/requirements.txt` — thêm `boto3>=1.34.0`
- `backend/app/core/config.py` — thêm 6 S3 config vars
- `backend/app/services/campaign_jobs.py` — dùng `get_storage()` sau download
- `backend/app/worker/cron.py` — dùng `get_storage()` trong `auto_post_job()`

**Files KHÔNG sửa:**
- `backend/app/services/fb_graph.py` — `upload_video_to_facebook(file_path=local_path)` vẫn nhận local path, không đổi
- `backend/app/models/models.py` — `Video.file_path` vẫn là String, không cần migration (lưu cả local path lẫn s3:// URL)
- `frontend/src/App.jsx` — không cần UI changes

### Edge Cases & Error Handling

1. **`STORAGE_BACKEND=s3` nhưng S3_BUCKET rỗng:** `get_storage()` raise `ValueError` → app fail fast khi startup, không fail silently
2. **S3 upload timeout:** `boto3` default timeout 60s — `upload_file` có `Config(multipart_threshold=...)` nếu file lớn
3. **S3 upload fail sau download:** Graceful fallback — giữ local path, log warning, video vẫn có thể post
4. **`os.path.exists()` trên S3 path:** `s3://...` → `os.path.exists()` trả False → cần đảm bảo KHÔNG còn direct `os.path.exists()` calls với `file_path`
5. **Temp file conflict:** Dùng `uuid.uuid4()` prefix trong temp filename → không conflict
6. **Retry video với S3 path:** `retry_video_download()` trong `campaign_jobs.py` cũng cần `storage` — check và update nếu cần

### Anti-Patterns to Avoid

- **KHÔNG** trực tiếp `import boto3` trong `cron.py` hoặc `campaign_jobs.py` — chỉ import qua `get_storage()` factory
- **KHÔNG** hard-code `s3://` prefix checks trực tiếp trong `cron.py` — dùng `storage.exists()` và `storage.get_local_copy()` (polymorphism)
- **KHÔNG** thêm S3 logic vào `fb_graph.py` — file này nhận local path, giữ nguyên
- **KHÔNG** gọi `get_storage()` trong mỗi loop iteration — khởi tạo một lần trước loop
- **KHÔNG** bỏ qua temp file cleanup sau S3 download — dù là MVP vẫn nên cleanup trong happy path

### References

- [Source: architecture.md#D3: Storage Abstraction Architecture]
- [Source: epics.md#Epic 8, Story 8.1]
- [Source: backend/app/services/campaign_jobs.py — sync_campaign_content(), dòng 198-205]
- [Source: backend/app/worker/cron.py — auto_post_job(), dòng 91-133]
- [Source: backend/requirements.txt — hiện KHÔNG có boto3]
- [Source: backend/app/core/config.py — Settings class pattern]
- [Source: boto3 docs — upload_file, download_file, head_object, delete_object]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### Change Log

### File List

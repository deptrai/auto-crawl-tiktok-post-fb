from __future__ import annotations

import logging
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Protocol

from app.core.config import settings

logger = logging.getLogger(__name__)


# S3 keys allow most chars but reserved/special chars complicate listing,
# presigned URLs, and CLI use. Replace anything outside this safe set.
_SAFE_KEY_CHARS = re.compile(r"[^A-Za-z0-9._-]")
_MAX_FILENAME_LEN = 200


def _sanitize_filename(name: str) -> str:
    """Slugify a filename for safe use as part of an S3 key."""
    name = os.path.basename(name).strip() or "video"
    safe = _SAFE_KEY_CHARS.sub("_", name)
    safe = safe.strip("._-") or "video"
    if len(safe) > _MAX_FILENAME_LEN:
        # Preserve extension when truncating.
        root, ext = os.path.splitext(safe)
        ext = ext[: max(0, _MAX_FILENAME_LEN - 1)]
        root = root[: _MAX_FILENAME_LEN - len(ext)]
        safe = f"{root}{ext}"
    return safe


class StorageBackend(Protocol):
    def save(self, local_path: str, remote_key: str) -> str:
        """Lưu file từ local vào storage, trả về stored path (local path hoặc s3:// URL)."""
        ...

    def delete(self, stored_path: str) -> bool:
        """Xóa file khỏi storage."""
        ...

    def exists(self, stored_path: str) -> bool:
        """Kiểm tra file có tồn tại trong storage hay không."""
        ...

    def get_local_copy(self, stored_path: str) -> str:
        """Đảm bảo file có sẵn ở local filesystem, download từ S3 nếu cần."""
        ...

    def requires_temp_copy(self) -> bool:
        """True nếu get_local_copy() tạo file tạm cần xóa sau khi dùng."""
        ...


class LocalStorage:
    """Strategy Pattern — local filesystem. Backward compatible với Phase 1."""

    def save(self, local_path: str, remote_key: str) -> str:
        return local_path  # no-op: file đã ở local

    def delete(self, stored_path: str) -> bool:
        try:
            if os.path.exists(stored_path):
                os.remove(stored_path)
                return True
        except OSError as exc:
            logger.warning("LocalStorage.delete thất bại cho %s: %s", stored_path, exc)
        return False

    def exists(self, stored_path: str) -> bool:
        return os.path.exists(stored_path)

    def get_local_copy(self, stored_path: str) -> str:
        return stored_path

    def requires_temp_copy(self) -> bool:
        return False


class S3Storage:
    """Strategy Pattern — S3-compatible storage (AWS S3, Cloudflare R2, MinIO)."""

    def __init__(
        self,
        bucket: str,
        region: str,
        access_key: str,
        secret_key: str,
        endpoint_url: str | None = None,
        connect_timeout: int = 10,
        read_timeout: int = 120,
        max_attempts: int = 5,
    ):
        import boto3
        from botocore.config import Config

        self._bucket = bucket
        self._client_config = Config(
            retries={"max_attempts": max_attempts, "mode": "adaptive"},
            connect_timeout=connect_timeout,
            read_timeout=read_timeout,
        )
        kwargs = dict(
            region_name=region,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            config=self._client_config,
        )
        if endpoint_url:
            kwargs["endpoint_url"] = endpoint_url
        self._client = boto3.client("s3", **kwargs)

    def health_check(self) -> bool:
        """Optional: gọi head_bucket để verify credentials/connectivity."""
        try:
            self._client.head_bucket(Bucket=self._bucket)
            return True
        except Exception as exc:  # noqa: BLE001 - we re-classify in callers
            logger.warning("S3 health_check thất bại cho bucket %s: %s", self._bucket, exc)
            return False

    def _parse_key(self, s3_path: str) -> str:
        """Parse s3://{bucket}/{key} → key. Raise ValueError nếu sai bucket hoặc format."""
        prefix = f"s3://{self._bucket}/"
        if s3_path.startswith(prefix):
            return s3_path[len(prefix):]
        raise ValueError(
            f"S3 path không khớp bucket cấu hình: expected prefix '{prefix}', got '{s3_path}'"
        )

    def save(self, local_path: str, remote_key: str) -> str:
        self._client.upload_file(local_path, self._bucket, remote_key)
        return f"s3://{self._bucket}/{remote_key}"

    def delete(self, stored_path: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            key = self._parse_key(stored_path)
        except ValueError as exc:
            logger.error("S3Storage.delete từ chối path không hợp lệ: %s", exc)
            return False

        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "Unknown")
            # delete_object trên key không tồn tại vẫn trả 204; ClientError ở đây
            # là lỗi auth/network/bucket → cần log để janitor reconcile.
            logger.error(
                "S3Storage.delete ClientError code=%s key=%s: %s", code, key, exc
            )
            return False
        except Exception as exc:  # noqa: BLE001
            logger.error("S3Storage.delete unexpected key=%s: %s", key, exc)
            return False

    def exists(self, stored_path: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            key = self._parse_key(stored_path)
        except ValueError as exc:
            logger.warning("S3Storage.exists path không hợp lệ: %s", exc)
            return False

        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            # 404 / NoSuchKey → file thực sự không tồn tại.
            if code in {"404", "NoSuchKey", "NotFound"} or status == 404:
                return False
            # Các lỗi khác (403 auth, 503 transient, network) → raise để caller
            # phân biệt "không có file" với "không kiểm tra được".
            logger.error("S3Storage.exists ClientError code=%s key=%s", code, key)
            raise

    def get_local_copy(self, stored_path: str) -> str:
        """Download S3 object về temp file, trả về local path. Cleanup partial nếu lỗi."""
        key = self._parse_key(stored_path)
        filename = _sanitize_filename(os.path.basename(key))
        tmp_path = os.path.join(
            tempfile.gettempdir(), f"s3_dl_{uuid.uuid4().hex}_{filename}"
        )
        try:
            self._client.download_file(self._bucket, key, tmp_path)
            return tmp_path
        except Exception as exc:  # noqa: BLE001
            # Cleanup partial file để tránh /tmp leak.
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
            logger.error("Lỗi khi tải file từ S3 key=%s: %s", key, exc)
            raise RuntimeError(f"Không thể lấy bản sao local từ S3: {exc}") from exc

    def requires_temp_copy(self) -> bool:
        return True

    def get_public_url(self, stored_path: str, expiration: int = 3600) -> str:
        try:
            key = self._parse_key(stored_path)
            url = self._client.generate_presigned_url(
                'get_object',
                Params={'Bucket': self._bucket, 'Key': key},
                ExpiresIn=expiration
            )
            return url
        except Exception as exc:
            logger.error("S3Storage.get_public_url lỗi: %s", exc)
            raise RuntimeError(f"Không thể tạo presigned URL từ S3: {exc}") from exc


_VALID_BACKENDS = {"local", "s3"}


def _resolve_backend_name() -> str:
    raw = (settings.STORAGE_BACKEND or "").strip().lower()
    if raw not in _VALID_BACKENDS:
        raise ValueError(
            f"STORAGE_BACKEND không hợp lệ: '{settings.STORAGE_BACKEND}'. "
            f"Chỉ chấp nhận: {sorted(_VALID_BACKENDS)}"
        )
    return raw


@lru_cache(maxsize=1)
def _build_storage() -> StorageBackend:
    """Tạo StorageBackend duy nhất; cache để reuse boto3 client."""
    backend = _resolve_backend_name()
    if backend == "s3":
        if not settings.S3_BUCKET:
            raise ValueError("S3_BUCKET chưa được cấu hình khi STORAGE_BACKEND=s3")

        endpoint = settings.S3_ENDPOINT_URL.strip() if settings.S3_ENDPOINT_URL else None
        if endpoint and not (endpoint.startswith("http://") or endpoint.startswith("https://")):
            endpoint = f"https://{endpoint}"

        return S3Storage(
            bucket=settings.S3_BUCKET,
            region=settings.S3_REGION,
            access_key=settings.S3_ACCESS_KEY,
            secret_key=settings.S3_SECRET_KEY,
            endpoint_url=endpoint,
        )
    return LocalStorage()


def get_storage() -> StorageBackend:
    """Factory: trả StorageBackend dựa trên settings.STORAGE_BACKEND. Cached."""
    return _build_storage()


def reset_storage_cache() -> None:
    """Clear cached storage instance — dùng cho tests hoặc khi đổi cấu hình runtime."""
    _build_storage.cache_clear()


def build_s3_key(local_path: str) -> str:
    """Tạo S3 key duy nhất theo convention: videos/{YYYY}/{MM}/{unique_id}_{filename}."""
    now = datetime.now(timezone.utc)
    unique_id = uuid.uuid4().hex[:8]
    filename = _sanitize_filename(os.path.basename(local_path))
    return f"videos/{now.year}/{now.month:02d}/{unique_id}_{filename}"

def reset_storage_cache() -> None:
    """Clear cached storage instance — dùng cho tests hoặc khi đổi cấu hình runtime."""
    _build_storage.cache_clear()


def build_s3_key(local_path: str) -> str:
    """Tạo S3 key duy nhất theo convention: videos/{YYYY}/{MM}/{unique_id}_{filename}."""
    now = datetime.now(timezone.utc)
    unique_id = uuid.uuid4().hex[:8]
    filename = _sanitize_filename(os.path.basename(local_path))
    return f"videos/{now.year}/{now.month:02d}/{unique_id}_{filename}"

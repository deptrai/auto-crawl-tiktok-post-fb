from __future__ import annotations
import os
import warnings
from dotenv import load_dotenv

load_dotenv(".env")           # base config (local dev)
load_dotenv("runtime.env", override=True)  # dashboard overrides

DEFAULT_JWT_SECRET = "change-me-jwt-secret"
DEFAULT_TOKEN_ENCRYPTION_SECRET = "change-me-token-secret"
DEFAULT_DOWNLOAD_DIR = "/app/downloads" if os.path.isdir("/app") else os.path.join(os.getcwd(), "downloads")


def split_csv_env(raw_value: str) -> list[str]:
    return [item.strip() for item in raw_value.split(",") if item.strip()]


def parse_bool_env(raw_value: str | None, default: bool) -> bool:
    if raw_value is None:
        return default
    return raw_value.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    PROJECT_NAME: str = "Hệ thống tự động mạng xã hội"
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://admin:adminpassword@db/social_auto")
    DOWNLOAD_DIR: str = os.getenv("DOWNLOAD_DIR", DEFAULT_DOWNLOAD_DIR)
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "admin123")
    DEFAULT_ADMIN_USERNAME: str = os.getenv("DEFAULT_ADMIN_USERNAME", "admin")
    DEFAULT_ADMIN_DISPLAY_NAME: str = os.getenv("DEFAULT_ADMIN_DISPLAY_NAME", "Quản trị viên")
    BASE_URL: str = os.getenv("BASE_URL", "http://localhost:8000")
    FB_VERIFY_TOKEN: str = os.getenv("FB_VERIFY_TOKEN", "social_auto_2026")
    FB_APP_SECRET: str = os.getenv("FB_APP_SECRET", "")
    TUNNEL_TOKEN: str = os.getenv("TUNNEL_TOKEN", "")
    JWT_SECRET: str = os.getenv("JWT_SECRET", DEFAULT_JWT_SECRET)
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    AUTH_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("AUTH_TOKEN_EXPIRE_MINUTES", "480"))
    TOKEN_ENCRYPTION_SECRET: str = os.getenv("TOKEN_ENCRYPTION_SECRET", DEFAULT_TOKEN_ENCRYPTION_SECRET)
    CORS_ALLOW_ORIGINS: list[str] = split_csv_env(os.getenv("CORS_ALLOW_ORIGINS", "*"))
    LOGIN_RATE_LIMIT_ATTEMPTS: int = int(os.getenv("LOGIN_RATE_LIMIT_ATTEMPTS", "5"))
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: int = int(os.getenv("LOGIN_RATE_LIMIT_WINDOW_SECONDS", "600"))
    LOGIN_LOCKOUT_SECONDS: int = int(os.getenv("LOGIN_LOCKOUT_SECONDS", "900"))
    PASSWORD_MIN_LENGTH: int = int(os.getenv("PASSWORD_MIN_LENGTH", "8"))
    SCHEDULER_INTERVAL_MINUTES: int = int(os.getenv("SCHEDULER_INTERVAL_MINUTES", "1"))
    TASK_QUEUE_POLL_SECONDS: int = int(os.getenv("TASK_QUEUE_POLL_SECONDS", "5"))
    WORKER_STALE_SECONDS: int = int(os.getenv("WORKER_STALE_SECONDS", "30"))
    WORKER_BATCH_SIZE: int = int(os.getenv("WORKER_BATCH_SIZE", "3"))
    SCHEDULER_ENABLED: bool = parse_bool_env(os.getenv("SCHEDULER_ENABLED"), True)
    AUTO_CREATE_SCHEMA: bool = parse_bool_env(os.getenv("AUTO_CREATE_SCHEMA"), False)
    BACKGROUND_JOBS_MODE: str = os.getenv("BACKGROUND_JOBS_MODE", "embedded")
    APP_ROLE: str = os.getenv("APP_ROLE", "api")
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()
    TIKTOK_PROXY: str = os.getenv("TIKTOK_PROXY", "")
    APIFY_API_TOKEN: str = os.getenv("APIFY_API_TOKEN", "")
    APIFY_ACTOR_ID: str = os.getenv("APIFY_ACTOR_ID", "kingscraper/tiktok-video-and-thumbnail-downloader")
    TIKTOK_CRAWLER_MODE: str = os.getenv("TIKTOK_CRAWLER_MODE", "auto")  # apify | ytdlp | auto


settings = Settings()

# --- Cảnh báo bảo mật khi khởi động ---
_INSECURE_DEFAULTS = {
    "JWT_SECRET": DEFAULT_JWT_SECRET,
    "TOKEN_ENCRYPTION_SECRET": DEFAULT_TOKEN_ENCRYPTION_SECRET,
}
for _key, _default in _INSECURE_DEFAULTS.items():
    _val = getattr(settings, _key)
    if _val == _default or not _val:
        warnings.warn(
            f"⚠️  BẢO MẬT: {_key} đang dùng giá trị mặc định hoặc trống! "
            f"Hãy set biến môi trường {_key} trước khi deploy production.",
            stacklevel=1,
        )
if settings.ADMIN_PASSWORD == "admin123":
    warnings.warn(
        "⚠️  BẢO MẬT: ADMIN_PASSWORD vẫn là 'admin123'! "
        "Hãy đổi mật khẩu admin ngay.",
        stacklevel=1,
    )

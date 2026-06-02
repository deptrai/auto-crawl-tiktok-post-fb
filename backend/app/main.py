from __future__ import annotations
import os
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app.api import analytics, auth, automation, campaigns, facebook, organizations, system, users, webhooks, youtube
from app.api.auth import require_authenticated_user
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.models import models  # noqa: F401
from app.models.automation import license as automation_license_models  # noqa: F401
from app.services.observability import configure_logging, record_event
from app.services.accounts import ensure_default_admin
from app.services.runtime_settings import write_runtime_env_file
from app.worker.cron import start_scheduler

configure_logging()

max_retries = 10
startup_error = None
retry_count = 0
while retry_count < max_retries:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        if settings.AUTO_CREATE_SCHEMA:
            Base.metadata.create_all(bind=engine)
        with SessionLocal() as db:
            ensure_default_admin(db)
            write_runtime_env_file(db)
        break
    except OperationalError as e:
        retry_count += 1
        if retry_count == max_retries:
            print(f"Failed to connect to database: {e}")
            startup_error = f"Database OperationalError: {e}"
            break
    except Exception as e:
        import traceback
        error_msg = f"Startup Exception: {e}\n{traceback.format_exc()}"
        print(error_msg)
        startup_error = error_msg
        break
    time.sleep(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    record_event(
        "system",
        "info",
        "Ứng dụng API đã khởi động.",
        details={"app_role": settings.APP_ROLE, "scheduler_enabled": settings.SCHEDULER_ENABLED},
    )
    if settings.SCHEDULER_ENABLED:
        start_scheduler()
    yield
    record_event("system", "warning", "Ứng dụng API đã dừng.", details={"app_role": settings.APP_ROLE})


from fastapi import Request
from fastapi.responses import JSONResponse
from app.api.deps import RBACException, RoleChecker

app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)

@app.exception_handler(RBACException)
async def rbac_exception_handler(request: Request, exc: RBACException):
    return JSONResponse(
        status_code=403,
        content={"detail": exc.message, "error": {"code": "HTTP_403", "message": exc.message}}
    )

app.include_router(auth.router)
app.include_router(campaigns.router, dependencies=[Depends(require_authenticated_user)])
app.include_router(facebook.router, dependencies=[Depends(require_authenticated_user)])
app.include_router(system.router, dependencies=[Depends(require_authenticated_user)])
app.include_router(users.router, dependencies=[Depends(require_authenticated_user)])
app.include_router(analytics.router, dependencies=[Depends(require_authenticated_user)])
app.include_router(youtube.router)
app.include_router(organizations.router, dependencies=[Depends(require_authenticated_user)])
app.include_router(automation.router)
app.include_router(webhooks.router)

os.makedirs(settings.DOWNLOAD_DIR, exist_ok=True)
app.mount("/downloads", StaticFiles(directory=settings.DOWNLOAD_DIR), name="downloads")

allow_origins = settings.CORS_ALLOW_ORIGINS or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials="*" not in allow_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def read_root():
    return {"message": "Chào mừng bạn đến với hệ thống tự động mạng xã hội"}


@app.get("/health")
def health_check():
    if startup_error:
        return {"status": "startup_failed", "error": startup_error}
    return {"status": "hoạt động bình thường"}

@app.get("/alembic-log")
def read_alembic_log():
    try:
        with open("/tmp/alembic.log", "r") as f:
            return {"log": f.read()}
    except Exception as e:
        return {"error": str(e)}

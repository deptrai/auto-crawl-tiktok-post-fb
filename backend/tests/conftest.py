import os
import atexit
from pathlib import Path

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
import pytest

TEST_DB_PATH = Path(__file__).with_name("test_suite.db")
TEST_PHASE3_DB_PATH = TEST_DB_PATH.with_suffix(".phase3.db")
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH.as_posix()}"

# M6: Cleanup DB file khi test process thoát (kể cả khi bị interrupt)
def _cleanup_test_db():
    if TEST_DB_PATH.exists():
        TEST_DB_PATH.unlink(missing_ok=True)
    if TEST_PHASE3_DB_PATH.exists():
        TEST_PHASE3_DB_PATH.unlink(missing_ok=True)

atexit.register(_cleanup_test_db)
os.environ["JWT_SECRET"] = "test-jwt-secret"
os.environ["TOKEN_ENCRYPTION_SECRET"] = "test-token-secret"
os.environ["ADMIN_PASSWORD"] = "admin12345"
os.environ["ROOT_ADMIN_PASSWORD"] = "admin12345"
os.environ["DEFAULT_ADMIN_USERNAME"] = "admin"
os.environ["DEFAULT_ADMIN_DISPLAY_NAME"] = "Quản trị viên kiểm thử"
os.environ["FB_VERIFY_TOKEN"] = "test-verify-token"
os.environ["PASSWORD_MIN_LENGTH"] = "8"
os.environ["SCHEDULER_ENABLED"] = "false"
os.environ["BACKGROUND_JOBS_MODE"] = "dedicated-worker"
os.environ["APP_ROLE"] = "api"

from app.api import analytics, auth, automation, campaigns, facebook, system, users, webhooks, youtube
from app.api.auth import require_authenticated_user
from app.api.deps import RBACException, RoleChecker
from fastapi import Request
from fastapi.responses import JSONResponse
from app.core.database import Base, SessionLocal, engine
from app.models.automation import license as automation_license_models  # noqa: F401
from app.services.accounts import ensure_default_admin


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        admin = ensure_default_admin(db)
        admin.must_change_password = False
        db.commit()
    finally:
        db.close()
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client():
    app = FastAPI()
    
    @app.exception_handler(RBACException)
    async def rbac_exception_handler(request: Request, exc: RBACException):
        return JSONResponse(
            status_code=403,
            content={"detail": exc.message, "error": {"code": "HTTP_403", "message": exc.message}}
        )

    app.include_router(auth.router)
    app.include_router(campaigns.router, dependencies=[Depends(require_authenticated_user)])
    app.include_router(facebook.router, dependencies=[Depends(require_authenticated_user), Depends(RoleChecker(["owner"]))])
    app.include_router(system.router, dependencies=[Depends(require_authenticated_user), Depends(RoleChecker(["owner"]))])
    app.include_router(users.router, dependencies=[Depends(require_authenticated_user)])
    app.include_router(analytics.router, dependencies=[Depends(require_authenticated_user)])
    app.include_router(youtube.router)
    app.include_router(automation.router)
    app.include_router(webhooks.router)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def auth_headers(client: TestClient):
    response = client.post(
        "/auth/login",
        json={"email": "admin@example.com", "password": os.environ["ADMIN_PASSWORD"]},
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

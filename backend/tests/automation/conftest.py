from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Iterator

import pytest
from alembic import command
from alembic.config import Config
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker


def _backend_dir() -> Path:
    return Path(__file__).resolve().parents[2]


def _assert_safe_test_database(database_url: str) -> None:
    url = make_url(database_url)
    database_name = url.database or ""
    host = url.host or ""
    if "test" not in database_name.lower() and "phase3" not in database_name.lower():
        raise RuntimeError(
            "Phase 3 automation tests refuse to reset a non-test database. "
            "Use PHASE3_TEST_DATABASE_URL with a database name containing 'test' or 'phase3'."
        )
    if host not in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeError("Phase 3 automation tests only reset local PostgreSQL databases.")


def _reset_postgres_database(database_url: str) -> None:
    engine = create_engine(database_url, isolation_level="AUTOCOMMIT")
    try:
        with engine.connect() as connection:
            connection.execute(text("DROP SCHEMA IF EXISTS phase3 CASCADE"))
            connection.execute(
                text(
                    "DO $$ "
                    "BEGIN "
                    "IF to_regclass('public.alembic_version') IS NOT NULL THEN "
                    "UPDATE public.alembic_version "
                    "SET version_num = '58dc46872d17' "
                    "WHERE version_num = '20260602_01_phase3_license_init'; "
                    "END IF; "
                    "END $$;"
                )
            )
    finally:
        engine.dispose()


def _run_alembic_upgrade(database_url: str) -> None:
    alembic_cfg = Config(str(_backend_dir() / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(_backend_dir() / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(alembic_cfg, "head")


def _truncate_phase3_tables(engine: Engine) -> None:
    with engine.begin() as connection:
        connection.execute(
            text("TRUNCATE TABLE phase3.license_activations, phase3.licenses RESTART IDENTITY CASCADE")
        )


@pytest.fixture(scope="session")
def postgres_database_url() -> Iterator[str]:
    configured_url = os.getenv("PHASE3_TEST_DATABASE_URL")
    if configured_url:
        yield configured_url
        return

    try:
        from testcontainers.postgres import PostgresContainer
    except ImportError as exc:  # pragma: no cover - exercised only when dev deps are missing.
        raise RuntimeError(
            "Install backend/requirements-dev.txt or set PHASE3_TEST_DATABASE_URL to run Phase 3 automation tests."
        ) from exc

    with PostgresContainer("postgres:15-alpine") as postgres:
        yield postgres.get_connection_url()


@pytest.fixture(scope="session")
def migrated_postgres(postgres_database_url: str) -> Iterator[str]:
    _assert_safe_test_database(postgres_database_url)
    os.environ["DATABASE_URL"] = postgres_database_url
    os.environ["AUTO_CREATE_SCHEMA"] = "false"
    os.environ["SCHEDULER_ENABLED"] = "false"

    if "app.core.database" in sys.modules:
        raise RuntimeError("app.core.database was imported before PostgreSQL test DATABASE_URL was configured.")

    _reset_postgres_database(postgres_database_url)
    _run_alembic_upgrade(postgres_database_url)
    yield postgres_database_url


@pytest.fixture(scope="session")
def postgres_engine(migrated_postgres: str) -> Iterator[Engine]:
    engine = create_engine(migrated_postgres)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture(scope="session")
def postgres_session_factory(postgres_engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=postgres_engine, expire_on_commit=False)


@pytest.fixture(autouse=True)
def clean_phase3_tables(postgres_engine: Engine) -> Iterator[None]:
    _truncate_phase3_tables(postgres_engine)
    yield
    _truncate_phase3_tables(postgres_engine)

@pytest.fixture(autouse=True)
def reset_activation_rate_limiter(migrated_postgres: str) -> Iterator[None]:
    # Import after migrated_postgres configures DATABASE_URL; app.api.automation imports app.core.database.
    from app.api.automation import reset_activation_rate_limiter

    reset_activation_rate_limiter()
    yield
    reset_activation_rate_limiter()


@pytest.fixture
def db_session(postgres_session_factory: sessionmaker[Session]) -> Iterator[Session]:
    db = postgres_session_factory()
    try:
        yield db
    finally:
        db.rollback()
        db.close()


@pytest.fixture
def client(postgres_session_factory: sessionmaker[Session]) -> Iterator[TestClient]:
    from app.api import automation

    app = FastAPI()

    def override_get_db() -> Iterator[Session]:
        db = postgres_session_factory()
        try:
            yield db
        finally:
            db.rollback()
            db.close()

    app.dependency_overrides[automation.get_db] = override_get_db
    app.include_router(automation.router)
    with TestClient(app) as test_client:
        yield test_client

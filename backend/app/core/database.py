from __future__ import annotations
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings


def _build_connect_args(database_url: str) -> dict:
    if database_url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


engine = create_engine(settings.DATABASE_URL, connect_args=_build_connect_args(settings.DATABASE_URL))


def _phase3_sqlite_path(database_url: str) -> str:
    raw_path = database_url.replace("sqlite:///", "", 1)
    if raw_path in {":memory:", ""}:
        return ":memory:"
    return f"{Path(raw_path).with_suffix('.phase3.db').as_posix()}"


if settings.DATABASE_URL.startswith("sqlite"):
    _phase3_path = _phase3_sqlite_path(settings.DATABASE_URL)

    @event.listens_for(engine, "connect")
    def _attach_phase3_schema(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute(f"ATTACH DATABASE '{_phase3_path}' AS phase3")
        cursor.close()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

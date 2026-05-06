from app.api.system import router, Depends
from sqlalchemy.orm import Session
from app.api.deps import get_db
import sqlalchemy as sa

@router.get("/overview_debug", tags=["System Debug"])
def get_overview_debug(db: Session = Depends(get_db)):
    try:
        res = db.execute(sa.text("SELECT * FROM alembic_version")).fetchall()
        return {"alembic_version": [dict(r._mapping) for r in res]}
    except Exception as e:
        import traceback
        return {"error": str(e), "trace": traceback.format_exc()}

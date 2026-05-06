import sys
from sqlalchemy import create_engine, text

def fix(db_url):
    engine = create_engine(db_url)
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE interactions_log ADD COLUMN IF NOT EXISTS organization_id UUID"))
            conn.execute(text("ALTER TABLE interactions_log ADD CONSTRAINT fk_interactions_log_org FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE"))
            print("Added organization_id to interactions_log")
        except Exception as e:
            print(f"Already exists or error: {e}")
        
        # fix alembic version if needed
        try:
            res = conn.execute(text("SELECT version_num FROM alembic_version")).fetchone()
            if res and res[0] not in ['58dc46872d17', 'c14f91eae2aa']:
                print(f"Fixing alembic version from {res[0]} to 58dc46872d17")
                conn.execute(text("UPDATE alembic_version SET version_num='58dc46872d17'"))
        except Exception as e:
            print(f"Alembic version fix error: {e}")

if __name__ == '__main__':
    from app.core.config import settings
    fix(settings.DATABASE_URL)

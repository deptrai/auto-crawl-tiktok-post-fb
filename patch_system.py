import traceback
import sys

def apply_patch():
    with open("backend/app/api/system.py", "r") as f:
        content = f.read()
    
    # Simple replace
    new_content = content.replace(
        "def get_system_overview(db: Session = Depends(get_db), org_id: uuid.UUID | None = Depends(get_current_organization_id)):",
        "def get_system_overview(db: Session = Depends(get_db), org_id: uuid.UUID | None = Depends(get_current_organization_id)):\n    try:\n        return _get_system_overview(db, org_id)\n    except Exception as e:\n        import traceback\n        return {\"error\": str(e), \"trace\": traceback.format_exc()}\n\ndef _get_system_overview(db, org_id):"
    )
    
    with open("backend/app/api/system.py", "w") as f:
        f.write(new_content)

apply_patch()

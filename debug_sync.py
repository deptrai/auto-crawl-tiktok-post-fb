from app.services.campaign_jobs import sync_campaign_content
from app.core.database import SessionLocal
from app.models.models import TaskQueue, TaskStatus
import sys

campaign_id = "0765c5d6-efe0-4fee-910d-193673ecc58a"
source_url = "https://www.tiktok.com/@vtv24news/video/7365445201192996114"

print(f"Starting manual sync for campaign {campaign_id}...")
try:
    # First, unlock the task in DB so we can run it here
    db = SessionLocal()
    task = db.query(TaskQueue).filter(TaskQueue.entity_id == campaign_id).first()
    if task:
        task.status = TaskStatus.queued
        task.locked_by = None
        task.locked_at = None
        db.commit()
        print("Unlocked existing task.")
    db.close()

    result = sync_campaign_content(campaign_id, source_url)
    print("Sync result:", result)
except Exception as e:
    import traceback
    print("Sync failed:")
    traceback.print_exc()

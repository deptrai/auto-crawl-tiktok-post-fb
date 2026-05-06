import sys
import os
import uuid
import json
import requests
from sqlalchemy.orm import Session

sys.path.append('/app')
from app.core.database import SessionLocal
from app.models.models import FacebookPage

def validate_and_update():
    db: Session = SessionLocal()
    try:
        token_file = "/app/fb_token.txt"
        if not os.path.exists(token_file):
            # Try outside /app if running from host-mapped
            token_file = "../fb_token.txt"
            
        with open(token_file, "r") as f:
            token = f.read().strip()
            
        print(f"Checking token: {token[:20]}...")
        
        # 1. Get user info and pages
        resp = requests.get(
            "https://graph.facebook.com/v22.0/me/accounts",
            params={"access_token": token}
        )
        data = resp.json()
        
        if "error" in data:
            print(f"Token error: {data['error']['message']}")
            return
            
        pages = data.get("data", [])
        print(f"Found {len(pages)} pages.")
        
        target_page_id = "490950160772961" # XB Global Việt Nam
        target_page = None
        
        for p in pages:
            print(f" - {p['name']} ({p['id']})")
            if p['id'] == target_page_id:
                target_page = p
                break
                
        if not target_page:
            print(f"Target page {target_page_id} not found in this token's accounts.")
            return
            
        page_token = target_page['access_token']
        page_name = target_page['name']
        
        # 2. Update DB
        db_page = db.query(FacebookPage).filter(FacebookPage.page_id == target_page_id).first()
        if not db_page:
            print(f"Page {target_page_id} not found in DB, creating...")
            db_page = FacebookPage(
                page_id=target_page_id,
                page_name=page_name,
                token_health_status="healthy"
            )
            db.add(db_page)
        
        db_page.long_lived_access_token = page_token
        db_page.token_health_status = "healthy"
        db_page.page_name = page_name
        
        db.commit()
        print(f"Successfully updated token for {page_name}")
        
    finally:
        db.close()

if __name__ == "__main__":
    validate_and_update()

import urllib.request
import urllib.parse
import json

BASE_URL = "http://localhost:8000"

# Login
login_data = json.dumps({
    "email": "admin@example.com",
    "password": "admin123"
}).encode('utf-8')

req = urllib.request.Request(f"{BASE_URL}/auth/login", data=login_data, headers={
    "Content-Type": "application/json"
})

try:
    response = urllib.request.urlopen(req)
    res_json = json.loads(response.read())
    token = res_json.get("access_token")
    print("Login successful.")
except Exception as e:
    error_msg = getattr(e, 'read', lambda: b"")().decode('utf-8')
    print(f"Login failed: {e} - {error_msg}")
    exit(1)

# Add Facebook config
fb_token = "EAAnxYoZBygVcBRWS59RYVHh97YjbqZAWx26HO9aZCuClbns7wZAT1n583gIXyjr1dOUwz7J81WNmicnLLQrUh5sGW6gLSQ3c3k4rthntx2gV8vydZChg3xE5TLZBVPch2rlrzU720898TyCumxmAJKTHa2mM34DDaIiiNrO7eW0IRhlxooXZBcn413wRrnHXzBkvnyBkbZCqe1tHrMdYo0aFdqx0ApBZA9JyhZCdVvirIzD52nPxBnE0ngZBjb8"

fb_data = json.dumps({
    "page_id": "490950160772961",
    "page_name": "XB Global Việt Nam",
    "long_lived_access_token": fb_token,
    "user_access_token": "",
    "auto_refresh_enabled": False
}).encode('utf-8')

req2 = urllib.request.Request(f"{BASE_URL}/facebook/config", data=fb_data, headers={
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
})

try:
    response2 = urllib.request.urlopen(req2)
    print("Config Facebook:", response2.status, response2.read().decode('utf-8'))
except Exception as e:
    error_msg = getattr(e, 'read', lambda: b"")().decode('utf-8')
    print(f"Config Facebook failed: {e} - {error_msg}")

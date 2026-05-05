import urllib.request
import urllib.parse
import json

BASE_URL = "http://medirus.167.172.66.16.traefik.me/api"

# Login
data = urllib.parse.urlencode({
    "username": "admin@example.com",
    "password": "Admin123_new"
}).encode()
req = urllib.request.Request(f"{BASE_URL}/auth/login", data=data)
response = urllib.request.urlopen(req)
res_json = json.loads(response.read())
token = res_json.get("access_token")

# Add Facebook config
with open("fb_token.txt") as f:
    fb_token = f.read().strip()

fb_data = json.dumps({
    "page_id": "114136934898124",
    "page_name": "XB Global Việt Nam",
    "long_lived_access_token": fb_token,
    "is_active": True
}).encode('utf-8')

req2 = urllib.request.Request(f"{BASE_URL}/facebook/config", data=fb_data, headers={
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
})
try:
    response2 = urllib.request.urlopen(req2)
    print("Config Facebook:", response2.status, response2.read().decode('utf-8'))
except Exception as e:
    print("Error:", getattr(e, 'read', lambda: b"")().decode('utf-8'))

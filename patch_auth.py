import sys

def patch():
    with open("backend/app/api/auth.py", "r") as f:
        content = f.read()
    
    replacement = """
    except Exception as e:
        import traceback
        raise HTTPException(status_code=500, detail=traceback.format_exc())
"""
    if "import traceback" not in content:
        # Patch the login function
        content = content.replace("def login(creds: LoginRequest, request: Request, db: Session = Depends(get_db)):", 
            "def login(creds: LoginRequest, request: Request, db: Session = Depends(get_db)):\n    try:")
        content = content.replace("        return {\n            \"access_token\": access_token, \n            \"refresh_token\": refresh_token,\n            \"token_type\": \"bearer\"\n        }\n\n    register_failed_login(client_id, email)\n    record_event(\"auth\", \"warning\", \"Đăng nhập thất bại.\", db=db, details={\"email\": email, \"ip\": client_id})\n    raise HTTPException(status_code=401, detail=\"Sai email đăng nhập hoặc mật khẩu!\")",
            "        return {\n            \"access_token\": access_token, \n            \"refresh_token\": refresh_token,\n            \"token_type\": \"bearer\"\n        }\n\n        register_failed_login(client_id, email)\n        record_event(\"auth\", \"warning\", \"Đăng nhập thất bại.\", db=db, details={\"email\": email, \"ip\": client_id})\n        raise HTTPException(status_code=401, detail=\"Sai email đăng nhập hoặc mật khẩu!\")\n" + replacement)
        
        with open("backend/app/api/auth.py", "w") as f:
            f.write(content)

patch()

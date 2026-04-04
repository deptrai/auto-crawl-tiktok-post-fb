from __future__ import annotations
import yt_dlp
import os
import uuid
from pathlib import Path

from app.core.config import settings

DOWNLOAD_DIR = settings.DOWNLOAD_DIR

# Thêm hỗ trợ Proxy hoặc Cookies từ file để bypass TikTok IP Block
TIKTOK_PROXY = os.getenv("TIKTOK_PROXY", None)
TIKTOK_COOKIES = os.getenv("TIKTOK_COOKIES", None) # Đường dẫn file cookies.txt

def _get_base_opts() -> dict:
    opts = {
        'quiet': True,
        'no_warnings': True,
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    }
    if TIKTOK_PROXY:
        opts['proxy'] = TIKTOK_PROXY
    if TIKTOK_COOKIES and os.path.exists(TIKTOK_COOKIES):
        opts['cookiefile'] = TIKTOK_COOKIES
    return opts

def extract_metadata(url: str):
    ydl_opts = _get_base_opts()
    ydl_opts.update({
        'skip_download': True,
        'extract_flat': False,
    })
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        return ydl.extract_info(url, download=False)

def download_video(url: str, filename_prefix: str = "video"):
    Path(DOWNLOAD_DIR).mkdir(parents=True, exist_ok=True)
    video_id = str(uuid.uuid4())
    filename = f"{filename_prefix}_{video_id}.mp4"
    out_path = os.path.join(DOWNLOAD_DIR, filename)

    ydl_opts = _get_base_opts()
    ydl_opts.update({
        'format': 'best[vcodec^=h264]/best[vcodec^=avc]/best',
        'outtmpl': out_path,
    })

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        return out_path, video_id
    except Exception as e:
        print(f"Lỗi tải video {url}: {e}")
        return None, None

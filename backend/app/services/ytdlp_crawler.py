from __future__ import annotations
import logging
import yt_dlp
import os
import uuid
from pathlib import Path

from app.core.config import settings

logger = logging.getLogger(__name__)

DOWNLOAD_DIR = settings.DOWNLOAD_DIR

# Thêm hỗ trợ Proxy hoặc Cookies từ file để bypass TikTok IP Block
TIKTOK_PROXY = settings.TIKTOK_PROXY or None
TIKTOK_COOKIES = os.getenv("TIKTOK_COOKIES", None)  # Đường dẫn file cookies.txt

# Timeout (giây) cho mỗi request — tránh yt-dlp hang vĩnh viễn khi TikTok block
SOCKET_TIMEOUT = int(os.getenv("YTDLP_SOCKET_TIMEOUT", "30"))
RETRIES = int(os.getenv("YTDLP_RETRIES", "2"))


def _get_impersonate_target():
    """Chọn impersonation target để bypass TikTok TLS fingerprinting.

    Adaptive: query yt-dlp xem những target nào thật sự khả dụng
    (phụ thuộc vào curl_cffi version), ưu tiên chrome mới nhất.
    Nếu không có target nào available → return None (yt-dlp tự fallback).
    """
    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.networking.impersonate import ImpersonateTarget

        # Probe available targets
        with YoutubeDL({'quiet': True, 'no_warnings': True}) as ydl:
            available = ydl._get_available_impersonate_targets()
        if not available:
            return None

        # Prefer chrome > edge > firefox; pick highest version available
        def _score(target_pair):
            target, _rh = target_pair
            client = (target.client or '').lower()
            client_rank = {'chrome': 3, 'edge': 2, 'firefox': 1}.get(client, 0)
            try:
                version = int(target.version or 0)
            except (TypeError, ValueError):
                version = 0
            return (client_rank, version)

        best = max(available, key=_score)
        target, _rh = best
        return ImpersonateTarget(
            client=target.client,
            version=target.version,
            os=target.os,
            os_version=target.os_version,
        )
    except Exception:
        return None


def _get_base_opts() -> dict:
    # Force NO_PROXY if no explicit TIKTOK_PROXY is provided
    if not settings.TIKTOK_PROXY:
        os.environ['NO_PROXY'] = '*'
        os.environ['no_proxy'] = '*'
    
    opts = {
        'quiet': True,
        'no_warnings': True,
        'socket_timeout': SOCKET_TIMEOUT,
        'retries': RETRIES,
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
        }
    }
    opts['proxy'] = TIKTOK_PROXY or ""
    if TIKTOK_COOKIES and os.path.exists(TIKTOK_COOKIES):
        opts['cookiefile'] = TIKTOK_COOKIES

    impersonate = _get_impersonate_target()
    if impersonate:
        opts['impersonate'] = impersonate

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
        # Broaden format chain: prefer h264/avc, then mp4 container merge, then mp4 ext, then bare best.
        # Avoids "No video formats found" when TikTok strips codec metadata from format list.
        'format': 'best[vcodec^=h264]/best[vcodec^=avc]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'outtmpl': out_path,
    })

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])
        # Validate file exists and is non-empty (silent yt-dlp failures leave 0-byte files)
        if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
            logger.error("yt-dlp download produced missing/empty file for url=%s", url)
            if os.path.exists(out_path):
                try:
                    os.remove(out_path)
                except OSError:
                    pass
            return None, None
        return out_path, video_id
    except Exception as e:
        logger.error("yt-dlp download failed for url=%s exc=%s: %s", url, type(e).__name__, e)
        if os.path.exists(out_path):
            try:
                os.remove(out_path)
            except OSError:
                pass
        return None, None

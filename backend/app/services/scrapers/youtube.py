"""YoutubeScraper — crawl YouTube Shorts bằng yt-dlp.

Hỗ trợ:
  - Channel URL: youtube.com/@channel, youtube.com/c/channel, youtube.com/channel/UCxxx
  - Shorts tab: youtube.com/@channel/shorts
  - Playlist URL: youtube.com/playlist?list=...
  - Single video: youtube.com/watch?v=...

Shorts filter: chỉ giữ video duration <= 60 giây.
"""
from __future__ import annotations
import glob
import logging
import os
import uuid
from pathlib import Path

import yt_dlp

from app.core.config import settings
from app.services.scrapers.base import BaseScraper

logger = logging.getLogger(__name__)

DOWNLOAD_DIR = settings.DOWNLOAD_DIR
SOCKET_TIMEOUT = int(os.getenv("YTDLP_SOCKET_TIMEOUT", "60"))
RETRIES = int(os.getenv("YTDLP_RETRIES", "2"))

# Duration threshold cho Shorts (giây)
SHORTS_MAX_DURATION = 60


def _get_yt_base_opts() -> dict:
    """Base yt-dlp options tối ưu cho YouTube (không cần TikTok impersonate)."""
    return {
        "quiet": True,
        "no_warnings": True,
        "socket_timeout": SOCKET_TIMEOUT,
        "retries": RETRIES,
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/136.0.0.0 Safari/537.36"
            )
        },
    }


def _normalize_channel_url(source_url: str) -> str:
    """Chuyển channel URL thành /shorts tab nếu chưa có, để yt-dlp fetch Shorts.

    Ví dụ:
      youtube.com/@channel       → youtube.com/@channel/shorts
      youtube.com/c/channel      → youtube.com/c/channel/shorts
      youtube.com/channel/UCxxx  → youtube.com/channel/UCxxx/shorts  (P3: legacy format)
      youtube.com/@channel/shorts → giữ nguyên
      youtube.com/playlist?list=... → giữ nguyên (playlist không cần /shorts)
    """
    url = source_url.rstrip("/")
    # Nếu là playlist hoặc đã có /shorts → giữ nguyên
    if "playlist?" in url or "/shorts" in url or "watch?" in url:
        return url
    # Channel URL: thêm /shorts để filter chỉ lấy Shorts tab
    # [P3] Thêm youtube.com/channel/UCxxx (legacy format)
    if (
        "youtube.com/@" in url
        or "youtube.com/c/" in url
        or "youtube.com/user/" in url
        or "youtube.com/channel/" in url
    ):
        return url + "/shorts"
    return url


def _map_entry_to_schema(entry: dict) -> dict:
    """Map yt-dlp entry dict sang schema chuẩn của pipeline.

    Schema chuẩn (tương thích Apify entry format trong campaign_jobs.py):
      id, webpage_url, title, description, view_count, like_count,
      comment_count, share_count, duration, _yt_download (flag)
    """
    video_id = str(entry.get("id") or uuid.uuid4())
    webpage_url = (
        entry.get("webpage_url")
        or entry.get("url")
        or f"https://www.youtube.com/watch?v={video_id}"
    )
    title = (entry.get("title") or "").strip()
    description = (entry.get("description") or "").strip()
    return {
        "id": video_id,
        "webpage_url": webpage_url,
        "title": title,
        "description": description or title,
        "view_count": int(entry.get("view_count") or 0),
        "like_count": int(entry.get("like_count") or 0),
        "comment_count": int(entry.get("comment_count") or 0),
        "share_count": 0,  # YouTube API không expose share count qua yt-dlp
        "duration": int(entry.get("duration") or 0),
        # Flag để campaign_jobs biết dùng YoutubeScraper.download_video
        "_yt_download": True,
    }


class YoutubeScraper(BaseScraper):
    """Scraper cho YouTube Shorts dùng yt-dlp."""

    def extract_metadata(self, source_url: str) -> dict:
        """Lấy danh sách YouTube Shorts từ channel/playlist URL.

        Dùng extract_flat=True để fetch playlist nhanh (không download).
        Filter duration <= 60s. Map sang schema chuẩn.
        """
        normalized_url = _normalize_channel_url(source_url)
        logger.info("YoutubeScraper.extract_metadata url=%s (normalized=%s)", source_url, normalized_url)

        opts = _get_yt_base_opts()
        opts.update(
            {
                "skip_download": True,
                # extract_flat: lấy danh sách video mà không fetch từng video
                "extract_flat": "in_playlist",
                # Không giới hạn số lượng ở đây — filter sau
                "playlistend": int(os.getenv("YT_MAX_VIDEOS", "50")),
            }
        )

        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(normalized_url, download=False)
        except Exception as exc:
            logger.error("YoutubeScraper.extract_metadata failed: %s", exc)
            return {"entries": []}

        if not info:
            return {"entries": []}

        # Single video (không phải playlist)
        if "entries" not in info:
            duration = info.get("duration") or 0
            if duration <= SHORTS_MAX_DURATION:
                return {"entries": [_map_entry_to_schema(info)]}
            logger.info("YoutubeScraper: single video duration=%ss > %ss, skipping", duration, SHORTS_MAX_DURATION)
            return {"entries": []}

        # Playlist / channel entries
        raw_entries = list(info.get("entries") or [])
        logger.info("YoutubeScraper: fetched %d raw entries from %s", len(raw_entries), normalized_url)

        shorts_entries = []
        for entry in raw_entries:
            if not entry:
                continue
            duration = entry.get("duration") or 0
            # extract_flat có thể trả duration=None cho một số entry → fetch riêng nếu cần
            # Nhưng để tránh N+1 requests, ta dùng heuristic: nếu duration=0/None,
            # chấp nhận entry (sẽ được filter ở bước download nếu quá dài).
            if duration and duration > SHORTS_MAX_DURATION:
                logger.debug("YoutubeScraper: skip entry id=%s duration=%ss", entry.get("id"), duration)
                continue
            shorts_entries.append(_map_entry_to_schema(entry))

        logger.info(
            "YoutubeScraper: %d/%d entries pass Shorts filter (<=%ss)",
            len(shorts_entries), len(raw_entries), SHORTS_MAX_DURATION,
        )
        return {"entries": shorts_entries}

    def download_video(self, url: str, filename_prefix: str = "youtube") -> tuple[str | None, str | None]:
        """Download YouTube video về local dùng yt-dlp.

        Format: ưu tiên mp4 h264 ≤1080p (mobile-friendly), fallback best.

        [P2] Trả về real YouTube video ID (extract từ yt-dlp) thay vì UUID ngẫu nhiên.
        [P1] Dùng outtmpl template %(id)s để yt-dlp tự quản lý tên file;
             sau download glob tìm file thực (yt-dlp có thể thêm extension khác).
        """
        Path(DOWNLOAD_DIR).mkdir(parents=True, exist_ok=True)

        # [P2] Extract real video ID trước download để dùng làm filename
        try:
            probe_opts = _get_yt_base_opts()
            probe_opts["skip_download"] = True
            probe_opts["quiet"] = True
            with yt_dlp.YoutubeDL(probe_opts) as ydl:
                probe_info = ydl.extract_info(url, download=False)
            real_video_id: str = str(probe_info.get("id") or uuid.uuid4())
        except Exception as probe_exc:
            logger.warning("YoutubeScraper: probe failed, using UUID as video_id: %s", probe_exc)
            real_video_id = str(uuid.uuid4())

        # [P1] outtmpl dùng prefix + real_video_id; yt-dlp sẽ append extension thực
        out_template = os.path.join(DOWNLOAD_DIR, f"{filename_prefix}_{real_video_id}.%(ext)s")
        # Expected final path nếu merge thành mp4
        expected_mp4 = os.path.join(DOWNLOAD_DIR, f"{filename_prefix}_{real_video_id}.mp4")

        opts = _get_yt_base_opts()
        opts.update(
            {
                # Format tối ưu mobile: mp4 h264 ≤1080p; fallback sang best mp4
                "format": (
                    "bestvideo[ext=mp4][height<=1080][vcodec^=avc]"
                    "+bestaudio[ext=m4a]"
                    "/bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]"
                    "/best[ext=mp4][height<=1080]"
                    "/best[ext=mp4]"
                    "/best"
                ),
                "outtmpl": out_template,
                # Merge thành mp4 container khi cần
                "merge_output_format": "mp4",
            }
        )

        logger.info("YoutubeScraper.download_video url=%s video_id=%s", url, real_video_id)
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])

            # [P1] Glob tìm file thực — yt-dlp có thể output tên khác expected_mp4
            # Ưu tiên expected_mp4; fallback glob pattern nếu không tìm thấy.
            if os.path.exists(expected_mp4) and os.path.getsize(expected_mp4) > 0:
                actual_path = expected_mp4
            else:
                pattern = os.path.join(DOWNLOAD_DIR, f"{filename_prefix}_{real_video_id}.*")
                candidates = [
                    p for p in glob.glob(pattern)
                    if os.path.isfile(p) and os.path.getsize(p) > 0
                ]
                actual_path = candidates[0] if candidates else None

            if not actual_path:
                logger.error(
                    "YoutubeScraper: no output file found after download url=%s pattern=%s",
                    url, os.path.join(DOWNLOAD_DIR, f"{filename_prefix}_{real_video_id}.*"),
                )
                return None, None

            logger.info("YoutubeScraper.download_video success path=%s size=%d", actual_path, os.path.getsize(actual_path))
            return actual_path, real_video_id
        except Exception as exc:
            logger.error("YoutubeScraper.download_video failed url=%s: %s", url, exc)
            # Cleanup: xóa bất kỳ partial file nào với prefix này
            for partial in glob.glob(os.path.join(DOWNLOAD_DIR, f"{filename_prefix}_{real_video_id}.*")):
                try:
                    os.remove(partial)
                except OSError:
                    pass
            return None, None

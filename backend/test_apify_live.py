"""Quick live test for Story 6-1: Apify TikTok Scraper integration.
Run: .venv/bin/python test_apify_live.py
"""
import json
import sys
import os

# Load .env
from dotenv import load_dotenv
load_dotenv(".env")

# Test 1: Config loading
print("=" * 60)
print("TEST 1: Config")
from app.core.config import settings
print(f"  APIFY_API_TOKEN : {'SET (' + settings.APIFY_API_TOKEN[:8] + '...)' if settings.APIFY_API_TOKEN else 'NOT SET'}")
print(f"  APIFY_ACTOR_ID  : {settings.APIFY_ACTOR_ID}")
print(f"  CRAWLER_MODE    : {settings.TIKTOK_CRAWLER_MODE}")
print(f"  ACTOR_TIMEOUT   : {settings.APIFY_ACTOR_TIMEOUT}s")
print()

# Test 2: _is_profile_url / _is_hashtag_url
print("=" * 60)
print("TEST 2: URL routing helpers")
from app.services.apify_crawler import (
    _is_profile_url, _is_hashtag_url, _is_clockworks_actor,
    _ALLOWED_DOWNLOAD_HOSTS, _ALLOWED_DOWNLOAD_SUFFIXES
)
cases = [
    ("https://www.tiktok.com/@vneconomy.vn", True, False),
    ("https://www.tiktok.com/@vneconomy.vn/video/7349940173516033281", False, False),
    ("https://www.tiktok.com/tag/vietnam", True, True),
    ("#vietnam", True, True),
]
all_pass = True
for url, exp_profile, exp_hashtag in cases:
    ok_p = _is_profile_url(url) == exp_profile
    ok_h = _is_hashtag_url(url) == exp_hashtag
    status = "OK" if (ok_p and ok_h) else "FAIL"
    if status == "FAIL":
        all_pass = False
    print(f"  [{status}] {url[:55]:<55} profile={_is_profile_url(url)} hashtag={_is_hashtag_url(url)}")
print(f"  => {'ALL PASS' if all_pass else 'SOME FAILED'}")
print()

# Test 3: Actor detection
print("=" * 60)
print("TEST 3: Actor detection")
actor_cases = [
    ("clockworks/tiktok-scraper", True),
    ("GdWCkxBtKWOsKjdch", True),
    ("kingscraper/tiktok-video-and-thumbnail-downloader", False),
]
for actor, expected in actor_cases:
    result = _is_clockworks_actor(actor)
    status = "OK" if result == expected else "FAIL"
    print(f"  [{status}] {actor} → clockworks={result}")
print()

# Test 4: SSRF allowlist
print("=" * 60)
print("TEST 4: SSRF allowlist")
from urllib.parse import urlparse
ssrf_cases = [
    ("https://api.apify.com/v2/datasets/abc/items", True),
    ("https://v19.tiktok.com/video/abc.mp4", True),
    ("https://v19-webapp.tiktok.com/video/abc.mp4", True),
    ("https://evil.com/redirect?to=api.apify.com", False),
    ("https://notapify.com/file.mp4", False),
    ("http://localhost/internal", False),
]
all_ssrf_pass = True
for url, should_allow in ssrf_cases:
    hostname = urlparse(url).hostname or ""
    allowed = (
        hostname in _ALLOWED_DOWNLOAD_HOSTS
        or any(hostname.endswith(s) for s in _ALLOWED_DOWNLOAD_SUFFIXES)
    )
    status = "OK" if allowed == should_allow else "FAIL"
    if status == "FAIL":
        all_ssrf_pass = False
    print(f"  [{status}] allow={allowed} expected={should_allow} | {hostname}")
print(f"  => {'ALL PASS' if all_ssrf_pass else 'SOME FAILED'}")
print()

# Test 5: _download_auto routing (F-01 fix verification)
print("=" * 60)
print("TEST 5: _download_auto URL routing (F-01 fix)")
from urllib.parse import urlparse
routing_cases = [
    # (url, expected_is_tiktok_webpage)
    ("https://www.tiktok.com/@user/video/123456", True),   # webpage → yt-dlp
    ("https://api.apify.com/v2/key-value-stores/abc/records/xyz", False),  # Apify KV → Apify download
    ("https://v19.tiktokcdn.com/abc/video.mp4", False),   # CDN → Apify download
    ("https://www.tiktok.com/tag/vietnam", False),         # hashtag → Apify (clockworks handles natively)
]
all_routing_pass = True
for url, exp_is_webpage in routing_cases:
    parsed = urlparse(url)
    hostname = parsed.hostname or ""
    is_tiktok_webpage = "tiktok.com" in hostname and ("/@" in url or "/video/" in parsed.path)
    status = "OK" if is_tiktok_webpage == exp_is_webpage else "FAIL"
    if status == "FAIL":
        all_routing_pass = False
    label = "→ yt-dlp" if is_tiktok_webpage else "→ Apify download"
    print(f"  [{status}] {url[:55]:<55} {label}")
print(f"  => {'ALL PASS' if all_routing_pass else 'SOME FAILED'}")
print()

# Test 6: Live Apify call (single video)
print("=" * 60)
print("TEST 6: Live Apify metadata call (single video)")
if not settings.APIFY_API_TOKEN:
    print("  SKIP: APIFY_API_TOKEN not configured")
else:
    test_url = "https://www.tiktok.com/@tiktok/video/7106594312292453675"
    print(f"  URL: {test_url}")
    print(f"  Actor: {settings.APIFY_ACTOR_ID}")
    print("  Calling Apify (may take 30-120s)...")
    try:
        from app.services.apify_crawler import extract_metadata_apify
        result = extract_metadata_apify(test_url, results_per_page=1)
        entries = result.get("entries", [])
        print(f"  Got {len(entries)} entries")
        if entries:
            e = entries[0]
            print(f"  id            : {e.get('id')}")
            print(f"  title         : {e.get('title', '')[:80]}")
            print(f"  webpage_url   : {e.get('webpage_url')}")
            download_url = e.get("_apify_download_url", "")
            print(f"  download_url  : {'SET (' + download_url[:40] + '...)' if download_url else 'EMPTY'}")
            print(f"  view_count    : {e.get('view_count')}")
            print(f"  like_count    : {e.get('like_count')}")
            print(f"  duration      : {e.get('duration')}s")
            print(f"  => PASS" if e.get("id") else "  => WARN: no id in entry")
        else:
            print("  => WARN: entries empty (actor returned no results)")
    except Exception as exc:
        print(f"  => FAIL: {type(exc).__name__}: {exc}")

print()
print("=" * 60)
print("Done.")

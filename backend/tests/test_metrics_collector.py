"""Tests cho metrics_collector — Story 11.1.

Round 2 patches: bổ sung test cho preventative rate limiter, parser robustness,
HTTP 429, JSONDecodeError, và Auth-failed không mutate page.auto_refresh_enabled.
"""
from unittest.mock import patch, MagicMock

import pytest
import requests

from app.services import metrics_collector as mc
from app.services.metrics_collector import (
    AuthFailedError,
    RateLimitError,
    TokenBucket,
    _fetch_batch_metrics,
    _parse_video_metrics,
)


# ---------------------------------------------------------------------------
# _fetch_batch_metrics — happy + error paths
# ---------------------------------------------------------------------------


def _mock_response(status: int, json_obj):
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = json_obj
    resp.text = ""
    return resp


def test_fetch_success_returns_data():
    payload = {
        "12345": {
            "likes": {"summary": {"total_count": 10}},
            "comments": {"summary": {"total_count": 5}},
            "shares": {"count": 2},
            "video_insights": {"data": [
                {"name": "post_video_views", "values": [{"value": 100}]},
                {"name": "post_impressions_unique", "values": [{"value": 80}]},
            ]},
        }
    }
    with patch("requests.get", return_value=_mock_response(200, payload)):
        data = _fetch_batch_metrics("url", {}, {})
    assert "12345" in data


def test_fetch_auth_error_raises():
    with patch("requests.get", return_value=_mock_response(400, {"error": {"code": 190}})):
        with pytest.raises(AuthFailedError):
            _fetch_batch_metrics("url", {}, {})


def test_fetch_rate_limit_via_error_code_raises():
    with patch("requests.get", return_value=_mock_response(400, {"error": {"code": 613}})):
        with pytest.raises(RateLimitError):
            _fetch_batch_metrics("url", {}, {})


def test_fetch_rate_limit_via_http_429_raises():
    """HTTP 429 status code (no JSON error.code) cũng phải raise RateLimitError."""
    resp = MagicMock()
    resp.status_code = 429
    resp.text = "Too Many Requests"
    with patch("requests.get", return_value=resp):
        with pytest.raises(RateLimitError):
            _fetch_batch_metrics("url", {}, {})


def test_fetch_invalid_json_returns_empty_dict():
    resp = MagicMock()
    resp.status_code = 200
    resp.json.side_effect = ValueError("not json")
    resp.text = "html error page"
    with patch("requests.get", return_value=resp):
        data = _fetch_batch_metrics("url", {}, {})
    assert data == {}


def test_fetch_other_graph_error_returns_empty_dict():
    """Generic Graph API error (non-auth, non-rate-limit) → empty dict, not raise."""
    with patch("requests.get", return_value=_mock_response(400, {"error": {"code": 999, "type": "Other"}})):
        data = _fetch_batch_metrics("url", {}, {})
    assert data == {}


# ---------------------------------------------------------------------------
# _parse_video_metrics — robustness
# ---------------------------------------------------------------------------


def test_parse_normal_payload():
    out = _parse_video_metrics({
        "likes": {"summary": {"total_count": 7}},
        "comments": {"summary": {"total_count": 3}},
        "shares": {"count": 1},
        "video_insights": {"data": [
            {"name": "post_video_views", "values": [{"value": 50}]},
            {"name": "post_impressions_unique", "values": [{"value": 30}]},
        ]},
    })
    assert out == {"views": 50, "likes": 7, "comments": 3, "shares": 1, "reach": 30}


def test_parse_missing_fields_defaults_to_zero():
    assert _parse_video_metrics({}) == {"views": 0, "likes": 0, "comments": 0, "shares": 0, "reach": 0}


def test_parse_null_likes_and_insights_handled():
    out = _parse_video_metrics({
        "likes": None,
        "comments": None,
        "shares": None,
        "video_insights": None,
    })
    assert out == {"views": 0, "likes": 0, "comments": 0, "shares": 0, "reach": 0}


def test_parse_empty_values_array():
    out = _parse_video_metrics({"video_insights": {"data": [{"name": "post_video_views", "values": []}]}})
    assert out["views"] == 0


def test_parse_null_values_first_element():
    out = _parse_video_metrics({"video_insights": {"data": [{"name": "post_video_views", "values": [None]}]}})
    assert out["views"] == 0


def test_parse_reach_uses_max_across_metric_names():
    """Cả `post_impressions_unique` và `post_video_views_unique` đều map sang reach
    — phải dùng max() chứ không overwrite."""
    out = _parse_video_metrics({"video_insights": {"data": [
        {"name": "post_impressions_unique", "values": [{"value": 30}]},
        {"name": "post_video_views_unique", "values": [{"value": 60}]},
    ]}})
    assert out["reach"] == 60


def test_parse_string_value_coerced_safely():
    """Value đôi khi đến dưới dạng string từ Graph API — không TypeError."""
    out = _parse_video_metrics({"video_insights": {"data": [{"name": "post_video_views", "values": [{"value": "not-a-number"}]}]}})
    assert out["views"] == 0


# ---------------------------------------------------------------------------
# TokenBucket rate limiter — AC5 preventative
# ---------------------------------------------------------------------------


def test_token_bucket_allows_up_to_capacity():
    bucket = TokenBucket(capacity=5, refill_rate_per_second=0.0)
    for _ in range(5):
        assert bucket.try_acquire(1) is True
    assert bucket.try_acquire(1) is False


def test_token_bucket_refills_over_time(monkeypatch):
    bucket = TokenBucket(capacity=2, refill_rate_per_second=10.0)
    fake_time = [1000.0]

    def now():
        return fake_time[0]

    monkeypatch.setattr(mc.time, "monotonic", now)
    bucket._last_refill = now()
    bucket._tokens = 0
    fake_time[0] += 0.5  # 0.5s × 10/s = 5 tokens (cap 2)
    assert bucket.try_acquire(2) is True
    assert bucket.try_acquire(1) is False


def test_token_bucket_respects_capacity_ceiling(monkeypatch):
    bucket = TokenBucket(capacity=10, refill_rate_per_second=1000.0)
    fake_time = [0.0]
    monkeypatch.setattr(mc.time, "monotonic", lambda: fake_time[0])
    bucket._last_refill = 0.0
    bucket._tokens = 0
    fake_time[0] = 1.0  # 1000 tokens generated, but cap=10
    assert bucket.available() == 10


def test_module_rate_limiter_capacity_200():
    """AC5: 200 calls/hour budget."""
    rl = mc.get_rate_limiter()
    assert rl.capacity == 200
    # Refill rate ≈ 200/3600
    assert abs(rl.refill_rate - 200 / 3600) < 1e-9


# ---------------------------------------------------------------------------
# Auth-failed không mutate page.auto_refresh_enabled
# ---------------------------------------------------------------------------


def test_auth_failed_does_not_mutate_page_flag():
    """Round 2 patch: auth fail → record event, KHÔNG set page.auto_refresh_enabled = False."""
    page = MagicMock()
    page.page_id = "p1"
    page.long_lived_access_token = "encrypted"
    page.auto_refresh_enabled = True

    db = MagicMock()
    db.add = MagicMock()
    db.commit = MagicMock()
    db.rollback = MagicMock()

    video = MagicMock()
    video.fb_post_id = "fb_x"
    video.id = "vid-x"

    with patch("app.services.metrics_collector.decrypt_secret", return_value="tok"), \
         patch("app.services.metrics_collector._fetch_batch_metrics", side_effect=AuthFailedError("bad token")), \
         patch("app.services.metrics_collector.record_event") as record:
        # Reset rate limiter để tránh test khác làm cạn budget.
        mc._RATE_LIMITER._tokens = 200
        ok = mc.fetch_metrics_for_page_videos(db, page, [video])

    assert ok is False
    # page.auto_refresh_enabled phải GIỮ NGUYÊN.
    assert page.auto_refresh_enabled is True
    # record_event được gọi với "AUTH_FAILED".
    auth_calls = [c for c in record.call_args_list if c.args and c.args[2] == "AUTH_FAILED"]
    assert len(auth_calls) == 1


def test_rate_limiter_exhaustion_short_circuits_remaining_chunks():
    """Khi budget cạn, function return False ngay không gọi _fetch_batch_metrics."""
    page = MagicMock()
    page.page_id = "p1"
    page.long_lived_access_token = "encrypted"

    videos = [MagicMock(fb_post_id=f"fb_{i}", id=f"v_{i}") for i in range(3)]

    with patch("app.services.metrics_collector.decrypt_secret", return_value="tok"), \
         patch("app.services.metrics_collector._fetch_batch_metrics") as fetch, \
         patch("app.services.metrics_collector.record_event"):
        mc._RATE_LIMITER._tokens = 0  # force exhaustion
        ok = mc.fetch_metrics_for_page_videos(MagicMock(), page, videos)

    assert ok is False
    fetch.assert_not_called()
    # restore for downstream tests
    mc._RATE_LIMITER._tokens = 200


# ---------------------------------------------------------------------------
# VideoStatus enum — bảo đảm code không reference giá trị không tồn tại
# ---------------------------------------------------------------------------


def test_video_status_enum_does_not_have_published():
    """Round 2 fix: enum không nên có `published` value (tránh code reference
    nhầm). Nếu một module thực sự reference `VideoStatus.published` ở runtime,
    Python sẽ raise AttributeError ngay khi load — đây là regression guard."""
    from app.models.models import VideoStatus

    assert not hasattr(VideoStatus, "published")
    # Verify _videos_to_collect query body bằng cách import + gọi nó với
    # session giả — nếu code có ref `.published`, AttributeError sẽ raise.
    import unittest.mock as um

    fake_session = um.MagicMock()
    fake_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = []
    # No exception expected.
    mc._videos_to_collect(fake_session, campaign_ids=[], last_id=None)

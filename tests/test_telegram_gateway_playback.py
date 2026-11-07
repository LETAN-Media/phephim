import pytest
import re
from urllib.parse import urlsplit, parse_qs
from fastapi.testclient import TestClient

from app.main import app
from app.services.source_service import sources, sign_telegram_gateway_url, is_telegram_gateway_url
from app.services.catalog import movie_for_slug
from app.core.config import STREAM_SIGNING_SECRET

client = TestClient(app)


def test_telegram_gateway_url_detection():
    url = "https://p01--telegram-stream-gateway--r4v2pzg2klvq.code.run/v1/stream/-1003868370207/7"
    assert is_telegram_gateway_url(url) is True
    assert is_telegram_gateway_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ") is False


def test_sign_telegram_gateway_url():
    raw_url = "https://p01--telegram-stream-gateway--r4v2pzg2klvq.code.run/v1/stream/-1003868370207/7"
    signed = sign_telegram_gateway_url(raw_url, ttl_seconds=3600)
    
    parts = urlsplit(signed)
    qs = parse_qs(parts.query)
    
    assert "exp" in qs
    assert "sig" in qs
    assert len(qs["sig"][0]) == 64  # sha256 hex length
    assert STREAM_SIGNING_SECRET not in signed  # secret never leaks


def test_sources_returns_permanent_stream_url_for_test_04():
    # Sources returns permanent clean URL for HTML5 player
    res = sources("test-04", "tap-1")
    assert len(res) >= 1

    source = res[0]
    assert source["media_type"] == "mp4"
    assert source["url"] == "/api/stream/test-04/tap-1.mp4"
    assert source["platform"] == "direct"


def test_permanent_stream_endpoint_requires_auth():
    # Unauthenticated request must return 401
    resp = client.get("/api/stream/test-04/tap-1.mp4", follow_redirects=False)
    assert resp.status_code == 401


def test_permanent_stream_endpoint_redirects_to_signed_gateway(monkeypatch):
    # Authenticated request returns 307 Temporary Redirect to signed Gateway URL
    from app.routers import playback
    monkeypatch.setattr(playback, "require_user", lambda request: {"id": 1, "username": "tester"})

    resp = client.get("/api/stream/test-04/tap-1.mp4", follow_redirects=False)
    assert resp.status_code == 307
    location = resp.headers.get("location")
    assert location is not None
    assert "p01--telegram-stream-gateway" in location
    assert "exp=" in location
    assert "sig=" in location
    assert "no-store" in resp.headers.get("cache-control", "").lower()


def test_permanent_stream_head_request_supported(monkeypatch):
    from app.routers import playback
    monkeypatch.setattr(playback, "require_user", lambda request: {"id": 1, "username": "tester"})

    resp = client.head("/api/stream/phim/tap-1.mp4", follow_redirects=False)
    assert resp.status_code == 307
    location = resp.headers.get("location")
    assert location is not None
    assert "p01--telegram-stream-gateway" in location


def test_permanent_stream_nonexistent_returns_404(monkeypatch):
    from app.routers import playback
    monkeypatch.setattr(playback, "require_user", lambda request: {"id": 1, "username": "tester"})

    resp = client.get("/api/stream/phim-khong-ton-tai-xyz/tap-1.mp4", follow_redirects=False)
    assert resp.status_code == 404


def test_movie_for_slug_finds_neon_published_video():
    movie = movie_for_slug("test-04")
    assert movie is not None
    assert movie["slug"] == "test-04"
    assert "title" in movie


def test_detail_page_loads_published_video():
    resp = client.get("/phim/test-04/")
    assert resp.status_code == 200
    assert "PHE PHIM AI" in resp.text


def test_nonexistent_movie_returns_404():
    resp = client.get("/phim/phim-khong-ton-tai-xyz-999/")
    assert resp.status_code == 404

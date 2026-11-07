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


def test_sources_returns_dynamically_signed_url_for_test_04():
    # test-04 is stored in Neon with stable unsigned URL
    res = sources("test-04", "tap-1")
    assert len(res) >= 1
    
    source = res[0]
    assert source["media_type"] == "mp4"
    assert "p01--telegram-stream-gateway" in source["url"]
    assert "exp=" in source["url"]
    assert "sig=" in source["url"]


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

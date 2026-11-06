"""Tests for Floating Community Chat Widget integration and assets."""
import os
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault('DATABASE_URL', 'postgresql://test:test@localhost/test')
os.environ.setdefault('APP_ORIGIN', 'https://testserver')

from app.main import app
from app.routers import movies

client = TestClient(app)

def test_chat_widget_assets_available():
    # CSS asset must be accessible
    resp_css = client.get('/static/css/chat-widget.css')
    assert resp_css.status_code == 200
    assert 'phe-chat-trigger' in resp_css.text
    assert 'phe-chat-window' in resp_css.text

    # JS asset must be accessible
    resp_js = client.get('/static/js/components/chat-widget.js')
    assert resp_js.status_code == 200
    assert 'phe-chat-widget' in resp_js.text
    assert 'connectWebSocket' in resp_js.text

def test_chat_widget_rendered_on_key_pages(monkeypatch):
    monkeypatch.setattr(movies, 'require_user', lambda request: {'id': 1})

    pages_to_check = [
        '/',
        '/phim/interstellar/',
        '/phim-bo/',
        '/phim-le/',
        '/the-loai/',
        '/xem-phim/interstellar/',
    ]

    for path in pages_to_check:
        resp = client.get(path)
        assert resp.status_code == 200, f"Failed on {path}"
        assert 'id="phe-chat-widget"' in resp.text, f"Missing widget on {path}"
        assert 'class="phe-chat-trigger"' in resp.text, f"Missing trigger on {path}"
        assert 'class="phe-chat-window"' in resp.text, f"Missing window on {path}"
        assert '/static/css/chat-widget.css' in resp.text, f"Missing css on {path}"
        assert '/static/js/components/chat-widget.js' in resp.text, f"Missing js on {path}"

def test_chat_widget_excluded_on_community_page():
    # If a request to /cong-dong/ was made through the app
    resp = client.get('/cong-dong/')
    # /cong-dong/ in production is rewritten to Cloudflare Worker, but in app if rendered
    # it must not duplicate the mini chat widget
    assert 'id="phe-chat-widget"' not in resp.text

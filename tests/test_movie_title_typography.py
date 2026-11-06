"""Tests for movie title H1 typography on detail and watch pages."""
from pathlib import Path
import re
from fastapi.testclient import TestClient
from app.main import app
from app.routers import movies

client = TestClient(app)

ROOT = Path(__file__).resolve().parent.parent

def test_movies_css_typography():
    css_path = ROOT / 'frontend/static/css/movies.css'
    content = css_path.read_text(encoding='utf-8')

    # Container flex protection
    assert '.detail>div{min-width:0;flex:1}' in content

    # H1 Desktop
    assert 'line-height:1.2' in content
    assert 'text-wrap:balance' in content
    assert 'overflow-wrap:break-word' in content
    assert 'word-break:break-word' in content
    assert 'clamp(36px,2.8vw,44px)' in content

    # H1 Tablet (max-width: 1024px: 32px-36px)
    assert 'clamp(32px,3.8vw,36px)' in content

    # H1 Mobile (max-width: 768px: 26px-30px)
    assert 'clamp(26px,4.5vw,30px)' in content


def test_movie_player_css_typography():
    css_path = ROOT / 'frontend/static/css/movie-player.css'
    content = css_path.read_text(encoding='utf-8')

    # Container flex protection
    assert '.watch-heading>div{min-width:0;flex:1}' in content

    # H1 Desktop
    assert 'line-height:1.2' in content
    assert 'text-wrap:balance' in content
    assert 'overflow-wrap:break-word' in content
    assert 'word-break:break-word' in content
    assert 'clamp(36px,2.8vw,44px)' in content

    # H1 Tablet (max-width: 1024px: 32px-36px)
    assert 'clamp(32px,3.8vw,36px)' in content

    # H1 Mobile (max-width: 768px: 26px-30px)
    assert 'clamp(26px,4.5vw,30px)' in content


def test_detail_and_watch_pages_serve_css(monkeypatch):
    # Detail page
    res_detail = client.get('/phim/vo-ngoai-tinh-voi-sep/')
    assert res_detail.status_code == 200
    assert '/movies.css' in res_detail.text

    # Watch page
    monkeypatch.setattr(movies, 'require_user', lambda request: {'id': 1})
    res_watch = client.get('/xem-phim/vo-ngoai-tinh-voi-sep/')
    assert res_watch.status_code == 200
    assert 'movie-player.css' in res_watch.text
    assert 'id="movie-title"' in res_watch.text

    # Static CSS endpoints
    res_css1 = client.get('/movies.css')
    assert res_css1.status_code == 200
    assert 'clamp(26px,4.5vw,30px)' in res_css1.text

    res_css2 = client.get('/static/css/movie-player.css')
    assert res_css2.status_code == 200
    assert 'clamp(26px,4.5vw,30px)' in res_css2.text

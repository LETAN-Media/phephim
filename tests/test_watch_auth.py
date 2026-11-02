"""Page routes and authorization without a live database."""
import os
from urllib.parse import parse_qs, urlsplit
os.environ.setdefault('DATABASE_URL', 'postgresql://test:test@localhost/test')
os.environ.setdefault('APP_ORIGIN', 'https://testserver')
from fastapi.testclient import TestClient
from app.main import app
from app.routers import movies

client = TestClient(app)

def test_watch_requires_login_and_retains_destination():
    response = client.get('/xem-phim/interstellar/', follow_redirects=False)
    assert response.status_code == 303
    target = urlsplit(response.headers['location'])
    assert target.path == '/dang-nhap/'
    assert parse_qs(target.query)['next'] == ['/xem-phim/interstellar/']
    assert 'no-store' in response.headers['cache-control']
    assert client.get('/phim/interstellar/').status_code == 200
    assert client.get('/tim-kiem/').status_code == 200

def test_watch_with_valid_session(monkeypatch):
    monkeypatch.setattr(movies, 'require_user', lambda request: {'id': 1})
    assert client.get('/xem-phim/interstellar/').status_code == 200
    assert client.get('/xem-phim/interstellar/index.html').status_code == 200

def test_page_assets_and_sensitive_files():
    for path in ('/', '/dang-nhap/', '/dang-ky/', '/ho-so/', '/static/css/auth-cinematic.css', '/static/js/movies/slider.js', '/frames/f_0008.webp'):
        assert client.get(path).status_code == 200, path
    for path in ('/.env', '/app/main.py', '/static/../.env'):
        assert client.get(path).status_code == 404, path

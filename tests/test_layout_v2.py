"""Keep the homepage V1 separate from the shared inner-page layout."""
import os
os.environ.setdefault('DATABASE_URL', 'postgresql://test:test@localhost/test')
os.environ.setdefault('APP_ORIGIN', 'https://testserver')
from fastapi.testclient import TestClient
from app.main import app
from app.routers import movies

client = TestClient(app)

def test_home_retains_v1():
    response = client.get('/')
    assert response.status_code == 200
    assert 'class="site-nav"' in response.text
    assert 'class="movie-footer"' in response.text
    assert 'data-header-v2' not in response.text
    assert 'header-v2.css' not in response.text

def test_inner_routes_and_404_use_v2():
    for path in ('/tim-kiem/', '/phim/interstellar/', '/dang-nhap/', '/dang-ky/', '/ho-so/', '/doi-mat-khau/', '/quen-mat-khau/', '/dat-lai-mat-khau/', '/xac-minh-email/', '/dieu-khoan/', '/missing-page/'):
        response = client.get(path)
        assert response.status_code == (404 if path == '/missing-page/' else 200)
        assert response.text.count('data-header-v2') == 1
        assert response.text.count('class="site-footer-v2"') == 1
        assert response.text.count('data-energy-background') == 1
    response = client.get('/api/missing')
    assert response.status_code == 404 and response.headers['content-type'].startswith('application/json')

def test_authenticated_watch_uses_v2(monkeypatch):
    monkeypatch.setattr(movies, 'require_user', lambda request: {'id': 1})
    response = client.get('/xem-phim/interstellar/')
    assert response.status_code == 200
    assert response.text.count('data-header-v2') == 1
    assert response.text.count('class="site-footer-v2"') == 1

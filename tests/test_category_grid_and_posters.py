"""Tests for category movie grid, poster frame 2:3 ratio, and typography."""
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
ROOT = Path(__file__).resolve().parent.parent

def test_category_stylesheet_exists_and_served():
    res = client.get('/static/css/category.css')
    assert res.status_code == 200
    assert 'text/css' in res.headers.get('content-type', '')

    res_alias = client.get('/category.css')
    assert res_alias.status_code == 200

def test_category_css_rules():
    css_path = ROOT / 'frontend/static/css/category.css'
    content = css_path.read_text(encoding='utf-8')

    # Poster 2:3 aspect-ratio and contain
    assert 'aspect-ratio: 2 / 3' in content
    assert 'object-fit: contain' in content
    assert '.poster-ambient' in content

    # Mobile 3 cols, Tablet 4 cols, Desktop 5-6 cols
    assert 'grid-template-columns: repeat(6, minmax(0, 1fr))' in content
    assert 'grid-template-columns: repeat(4, minmax(0, 1fr))' in content
    assert 'grid-template-columns: repeat(3, minmax(0, 1fr))' in content

    # Mobile gaps 8-10px
    assert '10px' in content
    assert '8px' in content

    # H1 font size mobile 28-32px
    assert 'clamp(28px, 6.8vw, 32px)' in content

    # Title clamp to 2 lines
    assert '-webkit-line-clamp: 2' in content

    # Genre heading alignment
    assert '.genre-heading' in content
    assert 'justify-content: space-between' in content

def test_category_pages_render_unified_cards():
    for cat in ['phim-bo', 'phim-le', 'the-loai']:
        res = client.get(f'/{cat}/')
        assert res.status_code == 200
        assert 'class="film-poster"' in res.text
        assert 'class="poster-ambient"' in res.text
        assert 'class="film-info"' in res.text
        assert 'class="film-meta"' in res.text
        assert 'tác phẩm' in res.text
        assert '/static/css/category.css' in res.text
    # /hoat-hinh/ is removed and returns 404
    assert client.get('/hoat-hinh/').status_code == 404

def test_landscape_movie_card():
    # Phim lẻ has 'VỢ NGOẠI TÌNH VỚI SẾP'
    res = client.get('/phim-le/')
    assert res.status_code == 200
    assert 'VỢ NGOẠI TÌNH VỚI SẾP' in res.text
    assert 'class="film-poster"' in res.text
    assert '/phim/vo-ngoai-tinh-voi-sep/' in res.text

def test_phim_ngan_empty_unified_layout():
    res = client.get('/phim-ngan/')
    assert res.status_code == 200
    assert '00 tác phẩm' in res.text
    assert 'Phim ngắn sẽ sớm được cập nhật.' in res.text

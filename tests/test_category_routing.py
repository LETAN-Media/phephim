import os
import re
os.environ.setdefault('DATABASE_URL', 'postgresql://test:test@localhost/test')
os.environ.setdefault('APP_ORIGIN', 'https://testserver')
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

CATEGORIES = ['phim-bo', 'phim-le', 'phim-ngan', 'hoat-hinh', 'the-loai']

def test_category_routes_status_200():
    for cat in CATEGORIES:
        for path in [f'/{cat}/', f'/{cat}']:
            res = client.get(path)
            assert res.status_code == 200, f"Expected 200 for {path}, got {res.status_code}"
            assert res.text.count('data-header-v2') == 1
            assert res.text.count('class="site-footer-v2"') == 1

def test_category_canonical_not_home():
    for cat in CATEGORIES:
        res = client.get(f'/{cat}/')
        match = re.search(r'<link rel="canonical" href="([^"]+)">', res.text)
        assert match is not None, f"Canonical tag missing on /{cat}/"
        canonical = match.group(1)
        expected = f'https://phephim.vercel.app/{cat}/'
        assert canonical == expected, f"Expected {expected}, got {canonical}"
        assert canonical != 'https://phephim.vercel.app/', "Canonical must not point to Home"

def test_category_robots_directive():
    # Empty / placeholder category must have noindex per requirement 6
    res_ngan = client.get('/phim-ngan/')
    assert '<meta name="robots" content="noindex, follow">' in res_ngan.text
    assert 'Phim ngắn sẽ sớm được cập nhật.' in res_ngan.text

    # Populated categories must have index, follow
    for cat in ['phim-bo', 'phim-le', 'hoat-hinh', 'the-loai']:
        res = client.get(f'/{cat}/')
        assert '<meta name="robots" content="index, follow">' in res.text

def test_category_ssr_html_and_movie_links():
    # Googlebot receives film cards with real links without running JS
    res_bo = client.get('/phim-bo/')
    assert '/phim/breaking-bad/' in res_bo.text
    assert '/phim/the-last-of-us/' in res_bo.text
    assert 'Breaking Bad' in res_bo.text
    assert 'The Last of Us' in res_bo.text

    res_le = client.get('/phim-le/')
    assert '/phim/dune-part-two/' in res_le.text
    assert '/phim/oppenheimer/' in res_le.text
    assert '/phim/interstellar/' in res_le.text
    assert '/phim/parasite/' in res_le.text

    res_hoat_hinh = client.get('/hoat-hinh/')
    assert '/phim/spirited-away/' in res_hoat_hinh.text
    assert 'Spirited Away' in res_hoat_hinh.text

    res_the_loai = client.get('/the-loai/')
    assert 'Khoa học viễn tưởng' in res_the_loai.text
    assert 'Chính kịch' in res_the_loai.text
    assert '/phim/dune-part-two/' in res_the_loai.text

def test_navigation_components_no_anchors():
    # Home navigation
    res_home = client.get('/')
    for cat in CATEGORIES:
        assert f'/#{cat}' not in res_home.text, f"/#{cat} anchor found in homepage navigation"
        assert f'/{cat}/' in res_home.text, f"/{cat}/ not found in homepage navigation"

    # Header V2 navigation
    res_inner = client.get('/phim-bo/')
    for cat in CATEGORIES:
        assert f'/#{cat}' not in res_inner.text, f"/#{cat} anchor found in header-v2"
        assert f'/{cat}/' in res_inner.text, f"/{cat}/ not found in header-v2"

def test_sitemap_and_robots():
    res_robots = client.get('/robots.txt')
    assert res_robots.status_code == 200
    assert 'Sitemap: https://phephim.vercel.app/sitemap.xml' in res_robots.text

    res_sitemap = client.get('/sitemap.xml')
    assert res_sitemap.status_code == 200
    assert '<loc>https://phephim.vercel.app/</loc>' in res_sitemap.text
    assert '<loc>https://phephim.vercel.app/phim-bo/</loc>' in res_sitemap.text
    assert '<loc>https://phephim.vercel.app/phim-le/</loc>' in res_sitemap.text
    assert '<loc>https://phephim.vercel.app/hoat-hinh/</loc>' in res_sitemap.text
    assert '<loc>https://phephim.vercel.app/the-loai/</loc>' in res_sitemap.text
    assert '<loc>https://phephim.vercel.app/phim/dune-part-two/</loc>' in res_sitemap.text
    # phim-ngan has noindex, so it must not be in sitemap
    assert '<loc>https://phephim.vercel.app/phim-ngan/</loc>' not in res_sitemap.text

def test_nonexistent_route_returns_404():
    res = client.get('/danh-muc-khong-ton-tai/')
    assert res.status_code == 404
    assert 'Không tìm thấy trang' in res.text or '404' in res.text

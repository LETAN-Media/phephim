import os
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.video_source_normalizer import (
    normalize_source_url,
    normalize_youtube,
    normalize_facebook,
    normalize_direct_stream,
    is_private_or_invalid_host,
)

client = TestClient(app)


def test_youtube_normalization():
    # Watch URL
    res = normalize_source_url('https://www.youtube.com/watch?v=sfDK-Znq-sE')
    assert res['platform'] == 'youtube'
    assert res['media_type'] == 'iframe'
    assert res['embed_url'] == 'https://www.youtube.com/embed/sfDK-Znq-sE'
    assert res['external_url'] == 'https://www.youtube.com/watch?v=sfDK-Znq-sE'

    # youtu.be short link with timestamp
    res2 = normalize_source_url('https://youtu.be/sfDK-Znq-sE?t=1m30s')
    assert res2['platform'] == 'youtube'
    assert res2['embed_url'] == 'https://www.youtube.com/embed/sfDK-Znq-sE?start=90'

    # YouTube shorts
    res3 = normalize_source_url('https://www.youtube.com/shorts/sfDK-Znq-sE')
    assert res3['platform'] == 'youtube'
    assert res3['embed_url'] == 'https://www.youtube.com/embed/sfDK-Znq-sE'

    # Existing embed URL
    res4 = normalize_source_url('https://www.youtube.com/embed/sfDK-Znq-sE')
    assert res4['platform'] == 'youtube'
    assert res4['embed_url'] == 'https://www.youtube.com/embed/sfDK-Znq-sE'


def test_facebook_normalization():
    # Facebook watch
    res = normalize_source_url('https://www.facebook.com/watch/?v=10153231379946729')
    assert res['platform'] == 'facebook'
    assert res['media_type'] == 'iframe'
    assert 'facebook.com/plugins/video.php' in res['embed_url']
    assert '10153231379946729' in res['embed_url']

    # Facebook videos path
    res2 = normalize_source_url('https://www.facebook.com/meta/videos/10153231379946729/')
    assert res2['platform'] == 'facebook'
    assert 'facebook.com/plugins/video.php' in res2['embed_url']

    # fb.watch shortlink
    res3 = normalize_source_url('https://fb.watch/abcdef123/')
    assert res3['platform'] == 'facebook'
    assert 'facebook.com/plugins/video.php' in res3['embed_url']


def test_direct_media_normalization():
    mp4 = normalize_source_url('https://cdn.example.com/movie.mp4')
    assert mp4['platform'] == 'direct'
    assert mp4['media_type'] == 'mp4'

    hls = normalize_source_url('https://cdn.example.com/live/master.m3u8')
    assert hls['platform'] == 'direct'
    assert hls['media_type'] == 'hls'

    dash = normalize_source_url('https://cdn.example.com/manifest.mpd')
    assert dash['platform'] == 'direct'
    assert dash['media_type'] == 'dash'

    local_demo = normalize_source_url('/static/media-demo/demo.mp4')
    assert local_demo['platform'] == 'direct'
    assert local_demo['media_type'] == 'mp4'


def test_security_rejections():
    # HTTP rejected
    with pytest.raises(ValueError, match='HTTPS'):
        normalize_source_url('http://www.youtube.com/watch?v=sfDK-Znq-sE')

    # Localhost / Private IPs rejected
    assert is_private_or_invalid_host('localhost')
    assert is_private_or_invalid_host('127.0.0.1')
    assert is_private_or_invalid_host('10.0.0.1')
    assert is_private_or_invalid_host('192.168.1.1')
    assert is_private_or_invalid_host('169.254.1.1')
    assert is_private_or_invalid_host('::1')

    with pytest.raises(ValueError, match='bị cấm'):
        normalize_source_url('https://127.0.0.1/video.mp4')

    with pytest.raises(ValueError, match='bị cấm'):
        normalize_source_url('https://localhost/video.mp4')

    # Javascript scheme
    with pytest.raises(ValueError):
        normalize_source_url('javascript:alert(1)')

    # Credentials in URL
    with pytest.raises(ValueError, match='xác thực'):
        normalize_source_url('https://admin:secret@youtube.com/watch?v=sfDK-Znq-sE')

    # Non-standard port
    with pytest.raises(ValueError, match='Cổng'):
        normalize_source_url('https://www.youtube.com:8443/watch?v=sfDK-Znq-sE')

    # CRLF injection
    with pytest.raises(ValueError, match='không hợp lệ'):
        normalize_source_url('https://www.youtube.com/watch?v=sfDK-Znq-sE\r\n')


def test_admin_api_authorization(monkeypatch):
    monkeypatch.setenv('ADMIN_API_KEY', 'test_secret_key_12345')

    # 1. Unauthenticated request to admin sources
    resp = client.get('/api/admin/movies/vo-ngoai-tinh-voi-sep/sources')
    assert resp.status_code == 401

    # 2. Regular user (non-admin)
    def fake_user(req, csrf=False):
        return {'id': 99, 'username': 'regular_user', 'email': 'user@example.com'}

    monkeypatch.setattr('app.services.admin_auth.require_user', fake_user)
    resp = client.get('/api/admin/movies/vo-ngoai-tinh-voi-sep/sources')
    assert resp.status_code == 403

    # 3. Invalid admin key
    resp = client.get(
        '/api/admin/movies/vo-ngoai-tinh-voi-sep/sources',
        headers={'X-Admin-Key': 'wrong_key'},
    )
    assert resp.status_code == 403

    # 4. Valid admin key
    resp = client.get(
        '/api/admin/movies/vo-ngoai-tinh-voi-sep/sources',
        headers={'X-Admin-Key': 'test_secret_key_12345'},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'sources' in data
    assert data['movie_slug'] == 'vo-ngoai-tinh-voi-sep'


def test_admin_source_crud_lifecycle(monkeypatch):
    monkeypatch.setenv('ADMIN_API_KEY', 'test_crud_key')
    headers = {'X-Admin-Key': 'test_crud_key'}

    # 1. Create YouTube source
    create_resp = client.post(
        '/api/admin/movies/vo-ngoai-tinh-voi-sep/sources',
        headers=headers,
        json={
            'movie_slug': 'vo-ngoai-tinh-voi-sep',
            'video_url': 'https://www.youtube.com/watch?v=sfDK-Znq-sE',
            'label': 'Nguồn 1 (YouTube)',
            'sort_order': 1,
            'enabled': True,
            'attribution': 'Bản quyền thuộc nhà sản xuất',
        },
    )
    assert create_resp.status_code == 201
    created = create_resp.json()
    source_id = created['id']
    assert created['platform'] == 'youtube'
    assert created['media_type'] == 'iframe'
    assert created['url'] == 'https://www.youtube.com/embed/sfDK-Znq-sE'
    assert created['label'] == 'Nguồn 1 (YouTube)'

    # 2. Create Facebook source
    fb_resp = client.post(
        '/api/admin/movies/vo-ngoai-tinh-voi-sep/sources',
        headers=headers,
        json={
            'movie_slug': 'vo-ngoai-tinh-voi-sep',
            'video_url': 'https://www.facebook.com/watch/?v=10153231379946729',
            'label': 'Nguồn 2 (Facebook)',
            'sort_order': 2,
            'enabled': True,
        },
    )
    assert fb_resp.status_code == 201
    fb_created = fb_resp.json()
    fb_id = fb_created['id']
    assert fb_created['platform'] == 'facebook'

    # 3. List sources via admin API
    list_resp = client.get('/api/admin/movies/vo-ngoai-tinh-voi-sep/sources', headers=headers)
    assert list_resp.status_code == 200
    sources = list_resp.json()['sources']
    found_ids = [s['id'] for s in sources]
    assert source_id in found_ids
    assert fb_id in found_ids

    # 4. Update source (e.g. toggle enabled, update label)
    upd_resp = client.put(
        f'/api/admin/sources/{source_id}',
        headers=headers,
        json={'label': 'Nguồn Chính (YouTube)', 'sort_order': 5},
    )
    assert upd_resp.status_code == 200
    assert upd_resp.json()['label'] == 'Nguồn Chính (YouTube)'
    assert upd_resp.json()['sort_order'] == 5

    # 5. Reorder sources
    reorder_resp = client.post(
        '/api/admin/movies/vo-ngoai-tinh-voi-sep/sources/reorder',
        headers=headers,
        json={'sources': [{'id': source_id, 'sort_order': 1}, {'id': fb_id, 'sort_order': 2}]},
    )
    assert reorder_resp.status_code == 200

    # 6. Delete test sources
    del1 = client.delete(f'/api/admin/sources/{source_id}', headers=headers)
    assert del1.status_code == 200
    del2 = client.delete(f'/api/admin/sources/{fb_id}', headers=headers)
    assert del2.status_code == 200

    # Verify they are gone
    list_after = client.get('/api/admin/movies/vo-ngoai-tinh-voi-sep/sources', headers=headers).json()
    after_ids = [s['id'] for s in list_after['sources']]
    assert source_id not in after_ids
    assert fb_id not in after_ids


def test_admin_session_email_auth(monkeypatch):
    def fake_admin_user(req, csrf=False):
        return {'id': 5, 'username': 'Colentanoi', 'email': 'letan.offcial@gmail.com'}

    monkeypatch.setattr('app.services.admin_auth.require_user', fake_admin_user)
    resp = client.get('/api/admin/movies/vo-ngoai-tinh-voi-sep/sources')
    assert resp.status_code == 200
    assert 'sources' in resp.json()


def test_playback_api_response_structure(monkeypatch):
    monkeypatch.setattr('app.routers.playback.require_user', lambda req: {'id': 5})
    resp = client.get('/api/movies/vo-ngoai-tinh-voi-sep/playback')
    assert resp.status_code == 200
    data = resp.json()
    assert data['movie_slug'] == 'vo-ngoai-tinh-voi-sep'
    assert len(data['sources']) >= 2
    yt = next(s for s in data['sources'] if s['platform'] == 'youtube')
    assert yt['media_type'] == 'iframe'
    assert 'youtube.com/embed/' in yt['url']
    assert 'external_url' in yt

    fb = next(s for s in data['sources'] if s['platform'] == 'facebook')
    assert fb['media_type'] == 'iframe'
    assert 'facebook.com/plugins/video.php' in fb['url']
    assert 'external_url' in fb


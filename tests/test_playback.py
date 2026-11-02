"""Playback security and route contracts without production data."""
import os
os.environ.setdefault('DATABASE_URL','postgresql://test:test@localhost/test')
os.environ.setdefault('APP_ORIGIN','https://testserver')
from fastapi.testclient import TestClient
from app.main import app
from app.routers import movies, playback
from app.schemas.playback import WatchProgress
from app.services.source_service import safe_url
from pydantic import ValidationError
import pytest

client=TestClient(app)

def test_source_url_allowlist(monkeypatch):
    monkeypatch.setenv('PLAYER_IFRAME_HOSTS','player.example.com')
    assert safe_url('https://media.example.com/film.m3u8')
    assert safe_url('/static/videos/film.mp4')
    for url in ('//evil.example/film.mp4','http://evil.example/film.mp4','https://user:pass@evil.example/a','/static/../secret','javascript:alert(1)'):
        assert not safe_url(url)
    assert safe_url('https://player.example.com/embed/1',iframe=True)
    assert not safe_url('https://player.example.com.evil.example/embed/1',iframe=True)
    assert not safe_url('https://player.example.com:99999/embed/1',iframe=True)

def test_episode_redirect_and_validation(monkeypatch):
    response=client.get('/xem-phim/breaking-bad/?episode=ep2',follow_redirects=False)
    assert response.status_code==303 and '%3Fepisode%3Dep2' in response.headers['location']
    response=client.get('/xem-phim/breaking-bad/?episode=//evil.example',follow_redirects=False)
    assert response.status_code==303 and '%3Fepisode' not in response.headers['location']
    with pytest.raises(ValidationError):WatchProgress(movie_slug='dune-part-two',position_seconds=float('nan'))
    with pytest.raises(ValidationError):WatchProgress(movie_slug='dune-part-two',position_seconds=4,user_id=99)

def test_progress_is_bound_to_session(monkeypatch):
    calls=[]
    def require(request, csrf=False): calls.append(('auth',csrf));return {'id':42}
    monkeypatch.setattr(playback,'require_user',require)
    monkeypatch.setattr(playback,'write_progress',lambda uid,slug,position,episode: calls.append((uid,slug,position,episode)))
    result=client.post('/api/users/me/watch-progress',json={'movie_slug':'dune-part-two','position_seconds':12})
    assert result.status_code==200
    assert calls==[('auth',True),(42,'dune-part-two',12.0,None)]
    result=client.post('/api/users/me/watch-progress',json={'movie_slug':'dune-part-two','position_seconds':12,'user_id':99})
    assert result.status_code==422

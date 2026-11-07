from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import RedirectResponse
from app.schemas.playback import WatchProgress
from app.services.auth import require_user
from app.services.catalog import movie_for_slug, catalog
from app.services.source_service import (
    episodes,
    episode_exists,
    sources,
    resolve_stream_source,
    sign_telegram_gateway_url,
)
from app.core.config import STREAM_URL_TTL_SECONDS
from app.services.playback_service import read_progress, write_progress

router=APIRouter()

def checked_movie(slug):
    movie=movie_for_slug(slug)
    if not movie: raise HTTPException(404, 'Không tìm thấy phim.')
    return movie

def checked_episode(slug, episode):
    if episode is not None and not episode_exists(slug,episode): raise HTTPException(404, 'Không tìm thấy tập phim.')

@router.get('/api/movies')
def movie_catalog(): return {'movies':list(catalog().values())}

@router.get('/api/movies/{slug}')
def movie(slug:str): return checked_movie(slug)

@router.get('/api/movies/{slug}/episodes')
def movie_episodes(slug:str):
    checked_movie(slug)
    return {'movie_slug':slug,'episodes':episodes(slug)}

@router.get('/api/movies/{slug}/playback')
def movie_playback(slug:str,request:Request):
    require_user(request); checked_movie(slug)
    return {'movie_slug':slug,'episode':None,'sources':sources(slug)}

@router.get('/api/movies/{slug}/episodes/{episode}/playback')
def episode_playback(slug:str,episode:str,request:Request):
    require_user(request); checked_movie(slug); checked_episode(slug,episode)
    return {'movie_slug':slug,'episode':episode,'sources':sources(slug,episode)}

@router.get('/api/users/me/watch-progress/{slug}')
def get_progress(slug:str,request:Request,episode:str|None=Query(default=None, min_length=1,max_length=64,pattern=r'^[A-Za-z0-9_-]+$')):
    user=require_user(request);checked_movie(slug);checked_episode(slug,episode)
    return read_progress(user['id'],slug,episode)

@router.post('/api/users/me/watch-progress')
def save_progress(data:WatchProgress,request:Request):
    user=require_user(request,True);checked_movie(data.movie_slug);checked_episode(data.movie_slug,data.episode)
    write_progress(user['id'],data.movie_slug,data.position_seconds,data.episode)
    return {'message':'Đã lưu tiến độ.'}


@router.get('/api/stream/{slug}/{episode}.mp4')
@router.head('/api/stream/{slug}/{episode}.mp4')
@router.get('/api/stream/{slug}/{episode}')
@router.head('/api/stream/{slug}/{episode}')
@router.get('/api/stream/{slug}.mp4')
@router.head('/api/stream/{slug}.mp4')
@router.get('/api/stream/{slug}')
@router.head('/api/stream/{slug}')
def permanent_stream(request: Request, slug: str, episode: str | None = None):
    """
    Permanent video stream URL for PHEPHIM.AI.
    Validates user session and movie publication status.
    Generates dynamic HMAC-SHA256 signed URL to Northflank Telegram Gateway.
    Redirects 307 (Temporary Redirect) preserving HTTP Range and request method.
    Strict anti-caching headers guarantee fresh signature on reconnection.
    """
    clean_slug = slug.removesuffix('.mp4')
    clean_ep = episode.removesuffix('.mp4') if episode else None

    # 1. Enforce access control
    require_user(request)

    # 2. Enforce publication status
    movie = movie_for_slug(clean_slug)
    if not movie or movie.get('status') == 'UNPUBLISHED' or movie.get('deleted'):
        raise HTTPException(404, 'Không tìm thấy phim hoặc phim đã bị gỡ.')

    # 3. Resolve active stream source
    source = resolve_stream_source(clean_slug, clean_ep)
    if not source:
        raise HTTPException(404, 'Không tìm thấy nguồn phát hoặc tập phim.')

    # 4. Generate dynamic HMAC signed URL to Telegram Gateway
    signed_url = sign_telegram_gateway_url(source['raw_url'], ttl_seconds=STREAM_URL_TTL_SECONDS)

    # 5. Return 307 Temporary Redirect with strict anti-caching headers
    return RedirectResponse(
        url=signed_url,
        status_code=307,
        headers={
            'Cache-Control': 'private, no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
        }
    )

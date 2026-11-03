from fastapi import APIRouter, HTTPException, Request, Query
from app.schemas.playback import WatchProgress
from app.services.auth import require_user
from app.services.catalog import movie_for_slug, catalog
from app.services.source_service import episodes, episode_exists, sources
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

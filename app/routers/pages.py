from pathlib import Path
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.templating import Jinja2Templates
from app.core.config import ROOT

router = APIRouter()
templates = Jinja2Templates(directory=str(ROOT / 'frontend/templates'))
PAGES = {
    'dang-nhap': 'auth/login.html', 'dang-ky': 'auth/register.html',
    'quen-mat-khau': 'auth/forgot.html', 'dat-lai-mat-khau': 'auth/reset.html',
    'doi-mat-khau': 'auth/change_password.html', 'ho-so': 'auth/profile.html',
    'xac-minh-email': 'auth/verify.html', 'dieu-khoan': 'auth/terms.html',
    'tim-kiem': 'movies/search.html',
}
STATIC = ROOT / 'frontend/static'
ALIASES = {'app.js':'js/movies/app.js','movie-api.js':'js/movies/movie-api.js',
           'auth.js':'js/auth/auth.js','auth-cinematic.js':'js/auth/cinematic.js',
           'movies.css':'css/movies.css','auth.css':'css/auth.css',
           'auth-cinematic.css':'css/auth-cinematic.css','hero_scrub.mp4':'images/hero_scrub.mp4'}

@router.get('/')
def home(request: Request):
    return templates.TemplateResponse(request=request, name='home.html')

@router.get('/{page}/')
@router.get('/{page}/index.html')
def page(request: Request, page: str):
    name = PAGES.get(page)
    if name is None:
        raise HTTPException(404)
    return templates.TemplateResponse(request=request, name=name)

@router.api_route('/static/{path:path}', methods=['GET', 'HEAD'])
def static_file(path: str):
    return safe_file(path)

def safe_file(path: str):
    requested = Path(path)
    if any(part.startswith('.') for part in requested.parts):
        raise HTTPException(404)
    file = (STATIC / requested).resolve()
    if not file.is_relative_to(STATIC.resolve()) or not file.is_file():
        raise HTTPException(404)
    if file.suffix.lower() not in {'.js','.css','.webp','.png','.mp4','.ico','.m3u8','.ts','.vtt','.mpd','.m4s'}:
        raise HTTPException(404)
    return FileResponse(file, media_type='video/mp2t' if file.suffix.lower() == '.ts' else None)

@router.get('/{name}')
def legacy_file(request: Request, name: str):
    if name == 'index.html':
        return templates.TemplateResponse(request=request, name='home.html')
    if name in PAGES:
        return templates.TemplateResponse(request=request, name=PAGES[name])
    path = ALIASES.get(name)
    if path is None:
        raise HTTPException(404)
    return safe_file(path)

@router.get('/{directory}/{path:path}')
def legacy_images(directory: str, path: str):
    if directory not in {'assets','frames','people','clips'}:
        raise HTTPException(404)
    return safe_file(f'images/{directory}/{path}')

from urllib.parse import quote, urlencode
import re
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from app.routers.pages import templates
from app.services.auth import require_user

router = APIRouter()
SLUGS = {'dune-part-two','oppenheimer','interstellar','parasite','spirited-away','breaking-bad','the-last-of-us','big-buck-bunny-demo'}

@router.get('/phim/{slug}/')
@router.get('/phim/{slug}')
@router.get('/phim/{slug}/index.html')
def detail(request: Request, slug: str):
    if slug not in SLUGS:
        raise HTTPException(404)
    return templates.TemplateResponse(request=request, name='movies/detail.html')

@router.get('/xem-phim/{slug}/')
@router.get('/xem-phim/{slug}')
@router.get('/xem-phim/{slug}/index.html')
def watch(request: Request, slug: str):
    # Keep authorization before page lookup, matching the original handler.
    try:
        require_user(request)
    except HTTPException as exc:
        if exc.status_code != 401:
            raise
        episode = request.query_params.get('episode', '')
        target = request.url.path
        if re.fullmatch(r'[A-Za-z0-9_-]{1,64}', episode):
            target += '?' + urlencode({'episode': episode})
        response = RedirectResponse('/dang-nhap/?next=' + quote(target, safe=''), status_code=303)
        response.headers['Cache-Control'] = 'private, no-store'
        return response
    if slug not in SLUGS:
        raise HTTPException(404)
    return templates.TemplateResponse(request=request, name='movies/watch.html')

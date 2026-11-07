from urllib.parse import quote, urlencode
import re
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from app.routers.pages import templates
from app.services.auth import require_user
from app.services.catalog import CATEGORY_META, get_movies_by_category, get_genre_catalog, movie_for_slug, MOVIE_ALIASES

router = APIRouter()
SLUGS = {'dune-part-two','oppenheimer','interstellar','parasite','spirited-away','breaking-bad','the-last-of-us','big-buck-bunny-demo','vo-ngoai-tinh-voi-sep'}

def render_category(request: Request, key: str):
    meta = CATEGORY_META.get(key)
    if not meta:
        raise HTTPException(404)
    is_genre_catalog = (key == 'the-loai')
    genre_catalog = get_genre_catalog() if is_genre_catalog else None
    movies = [] if is_genre_catalog else get_movies_by_category(key)
    total_count = sum(len(items) for items in genre_catalog.values()) if is_genre_catalog else len(movies)
    return templates.TemplateResponse(
        request=request,
        name='movies/category.html',
        context={
            'key': key,
            'title': meta['title'],
            'h1': meta['h1'],
            'eyebrow': meta['eyebrow'],
            'description': meta['description'],
            'canonical': meta['canonical'],
            'noindex': meta['noindex'],
            'movies': movies,
            'is_genre_catalog': is_genre_catalog,
            'genre_catalog': genre_catalog,
            'total_count': total_count,
        }
    )

@router.get('/phim-bo/')
@router.get('/phim-bo')
@router.get('/phim-bo/index.html')
def phim_bo(request: Request):
    return render_category(request, 'phim-bo')

@router.get('/phim-le/')
@router.get('/phim-le')
@router.get('/phim-le/index.html')
def phim_le(request: Request):
    return render_category(request, 'phim-le')

@router.get('/phim-ngan/')
@router.get('/phim-ngan')
@router.get('/phim-ngan/index.html')
def phim_ngan(request: Request):
    return render_category(request, 'phim-ngan')

@router.get('/the-loai/')
@router.get('/the-loai')
@router.get('/the-loai/index.html')
def the_loai(request: Request):
    return render_category(request, 'the-loai')

@router.get('/phim/{slug}/')
@router.get('/phim/{slug}')
@router.get('/phim/{slug}/index.html')
def detail(request: Request, slug: str):
    if slug in MOVIE_ALIASES:
        return RedirectResponse(f"/phim/{MOVIE_ALIASES[slug]}/", status_code=301)
    if not movie_for_slug(slug):
        raise HTTPException(404)
    return templates.TemplateResponse(request=request, name='movies/detail.html')

@router.get('/xem-phim/{slug}/')
@router.get('/xem-phim/{slug}')
@router.get('/xem-phim/{slug}/index.html')
def watch(request: Request, slug: str):
    if slug in MOVIE_ALIASES:
        episode = request.query_params.get('episode', '')
        dest = f"/xem-phim/{MOVIE_ALIASES[slug]}/"
        if episode:
            dest += f"?episode={quote(episode, safe='')}"
        return RedirectResponse(dest, status_code=301)
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
    if not movie_for_slug(slug):
        raise HTTPException(404)
    return templates.TemplateResponse(request=request, name='movies/watch.html')

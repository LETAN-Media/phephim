from fastapi import FastAPI, Request
from app.routers import auth, users, movies, pages, playback, admin_sources

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

@app.middleware('http')
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(('/api/', '/xem-phim/')):
        response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'no-referrer'
    return response

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(playback.router)
app.include_router(admin_sources.router)
app.include_router(movies.router)
app.include_router(pages.router)

# HTML navigation receives the shared site 404; API and asset errors retain JSON.
from fastapi.exception_handlers import http_exception_handler
from starlette.exceptions import HTTPException as StarletteHTTPException

@app.exception_handler(StarletteHTTPException)
async def not_found_page(request: Request, exc: StarletteHTTPException):
    path = request.url.path
    if exc.status_code != 404 or path == '/api' or path.startswith(('/api/', '/static/', '/assets/', '/frames/', '/clips/', '/people/', '/.')):
        return await http_exception_handler(request, exc)
    return pages.templates.TemplateResponse(request=request, name='not-found.html', status_code=404)

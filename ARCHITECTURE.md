# PHE PHIM AI source map

## Inventory before restructuring

The original root contained `auth_backend/` (one FastAPI module plus validation), the homepage and its inline animation, shared `app.js`, `movie-api.js`, `auth.js` and stylesheets. Six account URL directories contained identical HTML; seven `phim/` and seven `xem-phim/` directories and `tim-kiem/` contained identical movie-page HTML. `assets/`, `frames/` (362 frames), `people/`, `clips/`, and `hero_scrub.mp4` supplied the live homepage and movie UI. `index.html.bak` and `index.html.backup` were older copies, not runtime pages. Migrations and tests remain independent. `.env`, the Neon schema, logs and process state are not part of the source archive.

The pre-refactor source, including the newly redesigned authentication pages, is archived in `backups/source-before-modular-20261101.tar.gz`. Keep this archive for rollback.

## Runtime structure

- `app/main.py`: application assembly and security headers.
- `app/core/`: environment and database connection.
- `app/routers/`: page, movie, authentication and user URL registration.
- `app/services/`: session, CSRF, authentication, user and mail behavior.
- `app/models/`, `app/schemas/`: user shape and input validation.
- `frontend/templates/`: shared base, navigation and account layout; page templates.
- `frontend/static/css/`: original home/movie/account styles and cinematic authentication styles.
- `frontend/static/js/3d/`: extracted homepage animation; `movies/`: catalog, slider and routes; `auth/`: account behavior.
- `frontend/static/images/`: existing frames, clips, artwork and logo.
- `migrations/`, `tests/`, `logs/`, `run/`: database scripts, tests and runtime state.

Original public asset URLs remain supported by explicit aliases. New code can use `/static/`. No migration is run during startup. Run the server with `app.main:app`; see `AUTH_SETUP.md` for the command and HTTPS origin configuration.

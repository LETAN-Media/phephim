from sqlalchemy import text
from app.core.database import engine


def read_progress(user_id, slug, episode=None):
    with engine.connect() as db:
        if episode is None:
            row=db.execute(text('SELECT position_seconds,updated_at FROM watch_progress WHERE user_id=:uid AND movie_slug=:slug'),{'uid':user_id,'slug':slug}).mappings().first()
        else:
            row=db.execute(text('SELECT position_seconds,updated_at FROM episode_watch_progress WHERE user_id=:uid AND movie_slug=:slug AND episode_key=:episode'),{'uid':user_id,'slug':slug,'episode':episode}).mappings().first()
    return {'movie_slug':slug,'episode':episode,'position_seconds':float(row['position_seconds']) if row else 0,'updated_at':row['updated_at'] if row else None}


def write_progress(user_id, slug, position, episode=None):
    params={'uid':user_id,'slug':slug,'position':position,'episode':episode}
    with engine.begin() as db:
        if episode is None:
            db.execute(text('''INSERT INTO watch_progress(user_id,movie_slug,position_seconds) VALUES (:uid,:slug,:position)
            ON CONFLICT(user_id,movie_slug) DO UPDATE SET position_seconds=excluded.position_seconds,updated_at=now()'''),params)
        else:
            db.execute(text('''INSERT INTO episode_watch_progress(user_id,movie_slug,episode_key,position_seconds) VALUES (:uid,:slug,:episode,:position)
            ON CONFLICT(user_id,movie_slug,episode_key) DO UPDATE SET position_seconds=excluded.position_seconds,updated_at=now()'''),params)

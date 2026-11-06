from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Request, status
from sqlalchemy import text
from app.core.database import engine
from app.schemas.admin_sources import (
    CreateSourceSchema,
    ReorderSourcesSchema,
    UpdateSourceSchema,
)
from app.services.admin_auth import require_admin
from app.services.catalog import movie_for_slug
from app.services.source_service import episode_exists
from app.services.video_source_normalizer import normalize_source_url

router = APIRouter(prefix='/api/admin', tags=['admin_sources'])


def _check_movie_and_episode(slug: str, episode_key: Optional[str] = None):
    movie = movie_for_slug(slug)
    if not movie:
        raise HTTPException(status.HTTP_404_NOT_FOUND, 'Không tìm thấy phim.')
    if episode_key is not None and not episode_exists(slug, episode_key):
        raise HTTPException(status.HTTP_404_NOT_FOUND, 'Không tìm thấy tập phim.')
    return movie


@router.get('/movies/{slug}/sources')
def list_movie_sources(
    slug: str,
    request: Request,
    episode: Optional[str] = Query(default=None, max_length=64),
):
    require_admin(request)
    _check_movie_and_episode(slug, episode)

    with engine.connect() as db:
        if episode is not None:
            rows = db.execute(
                text('''SELECT id, movie_slug, episode_key, label, media_type, url, sort_order, enabled, attribution
                    FROM movie_sources
                    WHERE movie_slug = :slug AND episode_key = :episode
                    ORDER BY sort_order, id'''),
                {'slug': slug, 'episode': episode},
            ).mappings().all()
        else:
            rows = db.execute(
                text('''SELECT id, movie_slug, episode_key, label, media_type, url, sort_order, enabled, attribution
                    FROM movie_sources
                    WHERE movie_slug = :slug AND episode_key IS NULL
                    ORDER BY sort_order, id'''),
                {'slug': slug},
            ).mappings().all()

        results = []
        for r in rows:
            item = dict(r)
            try:
                norm = normalize_source_url(item['url'], platform_hint=item.get('media_type'))
                item['platform'] = norm['platform']
                item['external_url'] = norm['external_url']
            except ValueError:
                item['platform'] = 'iframe' if item['media_type'] == 'iframe' else 'direct'
                item['external_url'] = item['url']
            results.append(item)

    return {'movie_slug': slug, 'episode': episode, 'sources': results}


@router.post('/movies/{slug}/sources', status_code=status.HTTP_201_CREATED)
def create_movie_source(
    slug: str,
    data: CreateSourceSchema,
    request: Request,
):
    require_admin(request, csrf=True)
    if data.movie_slug != slug:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, 'movie_slug trong URL và body không khớp.')

    _check_movie_and_episode(slug, data.episode_key)

    try:
        norm = normalize_source_url(data.video_url, platform_hint=data.platform)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

    label = data.label
    if not label:
        plat_title = norm['platform'].capitalize()
        label = f'Nguồn phát {plat_title}'

    with engine.begin() as db:
        # Determine sort_order if not provided or 0
        if data.sort_order == 0:
            current_max = db.execute(
                text('''SELECT COALESCE(MAX(sort_order), 0) FROM movie_sources
                    WHERE movie_slug = :slug AND episode_key IS NOT DISTINCT FROM :episode'''),
                {'slug': slug, 'episode': data.episode_key},
            ).scalar_one()
            sort_order = current_max + 1
        else:
            sort_order = data.sort_order

        inserted = db.execute(
            text('''INSERT INTO movie_sources (movie_slug, episode_key, label, media_type, url, sort_order, enabled, attribution)
                VALUES (:slug, :episode_key, :label, :media_type, :url, :sort_order, :enabled, :attribution)
                RETURNING id, movie_slug, episode_key, label, media_type, url, sort_order, enabled, attribution'''),
            {
                'slug': slug,
                'episode_key': data.episode_key,
                'label': label,
                'media_type': norm['media_type'],
                'url': norm['embed_url'],
                'sort_order': sort_order,
                'enabled': data.enabled,
                'attribution': data.attribution,
            },
        ).mappings().first()

    result = dict(inserted)
    result['platform'] = norm['platform']
    result['external_url'] = norm['external_url']
    return result


@router.put('/sources/{source_id}')
def update_movie_source(
    source_id: int,
    data: UpdateSourceSchema,
    request: Request,
):
    require_admin(request, csrf=True)

    with engine.begin() as db:
        existing = db.execute(
            text('SELECT * FROM movie_sources WHERE id = :id'),
            {'id': source_id},
        ).mappings().first()

        if not existing:
            raise HTTPException(status.HTTP_404_NOT_FOUND, 'Không tìm thấy nguồn phát.')

        updates = {}
        if data.video_url is not None:
            try:
                norm = normalize_source_url(data.video_url, platform_hint=data.platform)
                updates['url'] = norm['embed_url']
                updates['media_type'] = norm['media_type']
            except ValueError as exc:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))

        if data.label is not None:
            updates['label'] = data.label
        if data.sort_order is not None:
            updates['sort_order'] = data.sort_order
        if data.enabled is not None:
            updates['enabled'] = data.enabled
        if data.attribution is not None:
            updates['attribution'] = data.attribution

        if not updates:
            return dict(existing)

        set_clauses = ', '.join(f'{k} = :{k}' for k in updates)
        updates['id'] = source_id

        updated = db.execute(
            text(f'''UPDATE movie_sources
                SET {set_clauses}
                WHERE id = :id
                RETURNING id, movie_slug, episode_key, label, media_type, url, sort_order, enabled, attribution'''),
            updates,
        ).mappings().first()

    result = dict(updated)
    try:
        norm = normalize_source_url(result['url'], platform_hint=result.get('media_type'))
        result['platform'] = norm['platform']
        result['external_url'] = norm['external_url']
    except ValueError:
        result['platform'] = 'iframe' if result['media_type'] == 'iframe' else 'direct'
        result['external_url'] = result['url']
    return result


@router.delete('/sources/{source_id}')
def delete_movie_source(
    source_id: int,
    request: Request,
):
    require_admin(request, csrf=True)

    with engine.begin() as db:
        existing = db.execute(
            text('SELECT id FROM movie_sources WHERE id = :id'),
            {'id': source_id},
        ).mappings().first()

        if not existing:
            raise HTTPException(status.HTTP_404_NOT_FOUND, 'Không tìm thấy nguồn phát.')

        db.execute(text('DELETE FROM movie_subtitles WHERE source_id = :id'), {'id': source_id})
        db.execute(text('DELETE FROM movie_sources WHERE id = :id'), {'id': source_id})

    return {'message': 'Đã xóa nguồn phát thành công.'}


@router.post('/movies/{slug}/sources/reorder')
def reorder_movie_sources(
    slug: str,
    data: ReorderSourcesSchema,
    request: Request,
):
    require_admin(request, csrf=True)
    _check_movie_and_episode(slug)

    with engine.begin() as db:
        for item in data.sources:
            db.execute(
                text('''UPDATE movie_sources
                    SET sort_order = :sort_order
                    WHERE id = :id AND movie_slug = :slug'''),
                {'id': item.id, 'sort_order': item.sort_order, 'slug': slug},
            )

    return {'message': 'Đã cập nhật thứ tự nguồn phát thành công.'}

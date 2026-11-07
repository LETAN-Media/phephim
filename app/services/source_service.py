import hashlib
import hmac
import os
import re
import time
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from sqlalchemy import text, bindparam
from app.core.database import engine
from app.core.config import STREAM_SIGNING_SECRET, STREAM_URL_TTL_SECONDS
from app.services.video_source_normalizer import get_allowed_iframe_hosts, normalize_source_url
from app.services.catalog import MOVIE_ALIASES

GATEWAY_STREAM_RE = re.compile(r'/v1/(?:stream|info|thumb|video|file)/([-\d]+)/(\d+)')


def is_telegram_gateway_url(url: str) -> bool:
    if not isinstance(url, str) or not url:
        return False
    return bool(GATEWAY_STREAM_RE.search(url))


def get_permanent_stream_url(slug: str, episode: str | None = None) -> str:
    """Generate the public, permanent, unexpiring stream URL for PHEPHIM.AI player."""
    clean_slug = slug.removesuffix('.mp4')
    if episode:
        clean_ep = str(episode).removesuffix('.mp4')
        return f"/api/stream/{clean_slug}/{clean_ep}.mp4"
    return f"/api/stream/{clean_slug}.mp4"


def resolve_stream_source(slug: str, episode: str | None = None) -> dict | None:
    """Resolve active Telegram stream parameters (chat_id, message_id, raw_url) from Neon DB."""
    clean_slug = MOVIE_ALIASES.get(slug.removesuffix('.mp4'), slug.removesuffix('.mp4'))
    clean_ep = episode.removesuffix('.mp4') if episode else None

    with engine.connect() as db:
        # 1. Search movie_sources
        if clean_ep:
            query = text('''
                SELECT s.id, s.movie_slug, s.episode_key, s.url, s.media_type, s.enabled
                FROM movie_sources s
                WHERE s.movie_slug = :slug
                  AND s.episode_key = :ep
                  AND s.enabled = true
                ORDER BY s.sort_order, s.id
            ''')
            rows = db.execute(query, {'slug': clean_slug, 'ep': clean_ep}).mappings().all()
        else:
            query = text('''
                SELECT s.id, s.movie_slug, s.episode_key, s.url, s.media_type, s.enabled
                FROM movie_sources s
                WHERE s.movie_slug = :slug
                  AND s.enabled = true
                ORDER BY s.sort_order, s.id
            ''')
            rows = db.execute(query, {'slug': clean_slug}).mappings().all()

        for r in rows:
            m = GATEWAY_STREAM_RE.search(r['url'])
            if m:
                return {
                    'chat_id': int(m.group(1)),
                    'message_id': int(m.group(2)),
                    'raw_url': r['url'],
                    'source_id': r['id'],
                    'movie_slug': r['movie_slug'],
                    'episode_key': r['episode_key'],
                }

        # 2. Fallback: search publish_records + telegram_media
        if clean_ep:
            p_query = text('''
                SELECT p.movie_slug, p.episode_key, p.status, tm.chat_id, tm.message_id, tm.stream_url
                FROM toolnet_auto.publish_records p
                JOIN toolnet_auto.telegram_media tm ON tm.bvid = p.bvid
                WHERE p.movie_slug = :slug
                  AND p.episode_key = :ep
                  AND p.status IN ('PUBLISHED', 'DRAFT')
                ORDER BY p.id DESC LIMIT 1
            ''')
            row = db.execute(p_query, {'slug': clean_slug, 'ep': clean_ep}).mappings().first()
        else:
            p_query = text('''
                SELECT p.movie_slug, p.episode_key, p.status, tm.chat_id, tm.message_id, tm.stream_url
                FROM toolnet_auto.publish_records p
                JOIN toolnet_auto.telegram_media tm ON tm.bvid = p.bvid
                WHERE p.movie_slug = :slug
                  AND p.status IN ('PUBLISHED', 'DRAFT')
                ORDER BY p.id DESC LIMIT 1
            ''')
            row = db.execute(p_query, {'slug': clean_slug}).mappings().first()

        if row:
            return {
                'chat_id': row['chat_id'],
                'message_id': row['message_id'],
                'raw_url': row['stream_url'],
                'source_id': None,
                'movie_slug': row['movie_slug'],
                'episode_key': row['episode_key'],
            }

    return None


def sign_telegram_gateway_url(url: str, ttl_seconds: int = STREAM_URL_TTL_SECONDS) -> str:
    """Sign a Telegram Stream Gateway URL dynamically with HMAC-SHA256."""
    secret = STREAM_SIGNING_SECRET
    if not secret or not url:
        return url
    parts = urlsplit(url)
    m = GATEWAY_STREAM_RE.search(parts.path)
    if not m:
        return url
    chat_id = int(m.group(1))
    message_id = int(m.group(2))
    exp = int(time.time()) + ttl_seconds
    msg = f"{chat_id}:{message_id}:{exp}".encode()
    sig = hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()

    query = parse_qs(parts.query)
    query['exp'] = [str(exp)]
    query['sig'] = [sig]
    new_query = urlencode(query, doseq=True)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, new_query, parts.fragment))


def safe_url(url, *, iframe=False):
    if not isinstance(url, str) or not url or any(c in url for c in ('\\', '\r', '\n', '\x00')):
        return False
    try:
        parts = urlsplit(url)
        port = parts.port
    except ValueError:
        return False
    if iframe:
        allowed = get_allowed_iframe_hosts()
        return (
            parts.scheme == 'https'
            and not parts.username
            and not parts.password
            and parts.hostname
            and parts.hostname.lower() in allowed
            and port in (None, 443)
        )
    if url.startswith(('/static/', '/api/stream/')) and not url.startswith('//'):
        return (
            not parts.scheme
            and not parts.netloc
            and all(part not in ('.', '..') and not part.startswith('.') for part in parts.path.split('/') if part)
        )
    return parts.scheme == 'https' and bool(parts.hostname) and not parts.username and not parts.password


def episodes(movie_slug):
    target_slug = MOVIE_ALIASES.get(movie_slug, movie_slug)
    with engine.connect() as db:
        return [
            dict(row)
            for row in db.execute(
                text('SELECT episode_key, title, sort_order FROM movie_episodes WHERE movie_slug=:slug ORDER BY sort_order, episode_key'),
                {'slug': target_slug},
            ).mappings()
        ]


def episode_exists(movie_slug, episode):
    return any(row['episode_key'] == episode for row in episodes(movie_slug))


def sources(movie_slug, episode=None):
    target_slug = MOVIE_ALIASES.get(movie_slug, movie_slug)
    with engine.connect() as db:
        if episode is not None:
            rows = db.execute(
                text('''SELECT id, label, media_type, url, attribution, movie_slug, episode_key FROM movie_sources
                    WHERE movie_slug=:slug AND episode_key=:episode AND enabled
                    ORDER BY sort_order, id'''),
                {'slug': target_slug, 'episode': episode},
            ).mappings().all()
        else:
            rows = db.execute(
                text('''SELECT id, label, media_type, url, attribution, movie_slug, episode_key FROM movie_sources
                    WHERE movie_slug=:slug AND episode_key IS NULL AND enabled
                    ORDER BY sort_order, id'''),
                {'slug': target_slug},
            ).mappings().all()
            if not rows:
                rows = db.execute(
                    text('''SELECT id, label, media_type, url, attribution, movie_slug, episode_key FROM movie_sources
                        WHERE movie_slug=:slug AND enabled
                        ORDER BY sort_order, id'''),
                    {'slug': target_slug},
                ).mappings().all()

        cleaned = []
        for r in rows:
            row_dict = dict(r)
            # Try normalizing URL if possible
            try:
                norm = normalize_source_url(row_dict['url'], platform_hint=row_dict.get('media_type'))
                row_dict['url'] = norm['embed_url']
                row_dict['media_type'] = norm['media_type']
                row_dict['platform'] = norm['platform']
                row_dict['external_url'] = norm['external_url']
            except ValueError:
                row_dict['platform'] = 'iframe' if row_dict['media_type'] == 'iframe' else 'direct'
                row_dict['external_url'] = row_dict['url']

            # Use permanent fixed URL on PHEPHIM.AI for Telegram Gateway video streams
            if is_telegram_gateway_url(row_dict['url']) or row_dict['url'].startswith('/api/stream/'):
                ep_key = row_dict.get('episode_key')
                row_dict['url'] = get_permanent_stream_url(row_dict.get('movie_slug') or movie_slug, ep_key)
                row_dict['media_type'] = 'mp4'
                row_dict['platform'] = 'direct'

            if safe_url(row_dict['url'], iframe=row_dict['media_type'] == 'iframe'):
                cleaned.append(row_dict)

        if not cleaned:
            return []

        query = text(
            'SELECT source_id, language, label, url, is_default FROM movie_subtitles WHERE source_id IN :ids ORDER BY id'
        ).bindparams(bindparam('ids', expanding=True))
        captions = db.execute(query, {'ids': [row['id'] for row in cleaned]}).mappings().all()

    for row in cleaned:
        row['subtitles'] = [
            dict(language=s['language'], label=s['label'], url=s['url'], is_default=s['is_default'])
            for s in captions
            if s['source_id'] == row['id'] and safe_url(s['url'])
        ]
    return cleaned

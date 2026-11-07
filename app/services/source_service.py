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

GATEWAY_STREAM_RE = re.compile(r'/v1/stream/([-\d]+)/(\d+)')


def is_telegram_gateway_url(url: str) -> bool:
    if not isinstance(url, str) or not url:
        return False
    return bool(GATEWAY_STREAM_RE.search(url))


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
    if url.startswith('/static/') and not url.startswith('//'):
        return (
            not parts.scheme
            and not parts.netloc
            and all(part not in ('.', '..') and not part.startswith('.') for part in parts.path.split('/') if part)
        )
    return parts.scheme == 'https' and bool(parts.hostname) and not parts.username and not parts.password


def episodes(movie_slug):
    with engine.connect() as db:
        return [
            dict(row)
            for row in db.execute(
                text('SELECT episode_key, title, sort_order FROM movie_episodes WHERE movie_slug=:slug ORDER BY sort_order, episode_key'),
                {'slug': movie_slug},
            ).mappings()
        ]


def episode_exists(movie_slug, episode):
    return any(row['episode_key'] == episode for row in episodes(movie_slug))


def sources(movie_slug, episode=None):
    with engine.connect() as db:
        rows = db.execute(
            text('''SELECT id, label, media_type, url, attribution FROM movie_sources
                WHERE movie_slug=:slug AND episode_key IS NOT DISTINCT FROM :episode AND enabled
                ORDER BY sort_order, id'''),
            {'slug': movie_slug, 'episode': episode},
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

            # Sign Telegram Gateway URLs dynamically for HTML5 player
            if is_telegram_gateway_url(row_dict['url']):
                row_dict['url'] = sign_telegram_gateway_url(row_dict['url'])

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

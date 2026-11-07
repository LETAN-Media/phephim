import os
from pathlib import Path
from urllib.parse import urlsplit
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / '.env')
DATABASE_URL = os.getenv('DATABASE_URL', '')
if not DATABASE_URL:
    raise RuntimeError('DATABASE_URL is required')
if DATABASE_URL.startswith('postgresql://'):
    DATABASE_URL = DATABASE_URL.replace('postgresql://', 'postgresql+psycopg://', 1)
if not DATABASE_URL.startswith('postgresql+psycopg://'):
    raise RuntimeError('DATABASE_URL must use PostgreSQL')
PRIMARY_ORIGIN = os.getenv('PRIMARY_ORIGIN', 'https://www.phephim.ai').rstrip('/')
ORIGIN = os.getenv('APP_ORIGIN', PRIMARY_ORIGIN).rstrip('/')
if not ORIGIN or urlsplit(ORIGIN).scheme not in ('https', 'http') or not urlsplit(ORIGIN).netloc or urlsplit(ORIGIN).path:
    raise RuntimeError('APP_ORIGIN must be a valid origin (e.g. https://www.phephim.ai)')

DEFAULT_ALLOWED_ORIGINS = {
    'https://www.phephim.ai',
    'https://phephim.ai',
    'https://phephim.vercel.app',
}

COOKIE = '__Host-phe_session'
CSRF_COOKIE = '__Host-phe_csrf'

TELEGRAM_GATEWAY_URL = os.getenv('TELEGRAM_GATEWAY_URL', 'https://p01--telegram-stream-gateway--r4v2pzg2klvq.code.run').rstrip('/')
STREAM_SIGNING_SECRET = os.getenv('STREAM_SIGNING_SECRET', '')
STREAM_URL_TTL_SECONDS = int(os.getenv('STREAM_URL_TTL_SECONDS', '21600'))

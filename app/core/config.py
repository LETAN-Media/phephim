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
ORIGIN = os.getenv('APP_ORIGIN', '').rstrip('/')
if not ORIGIN or urlsplit(ORIGIN).scheme != 'https' or not urlsplit(ORIGIN).netloc or urlsplit(ORIGIN).path:
    raise RuntimeError('APP_ORIGIN must be the HTTPS origin')
COOKIE = '__Host-phe_session'
CSRF_COOKIE = '__Host-phe_csrf'

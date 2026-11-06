import hashlib
import hmac
import logging
import os
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from urllib.parse import urlsplit
from fastapi import HTTPException, Request
from sqlalchemy import text
from app.core.config import COOKIE, CSRF_COOKIE, DEFAULT_ALLOWED_ORIGINS, ORIGIN, PRIMARY_ORIGIN
from app.core.database import engine
from app.models.user import PublicUser

logger = logging.getLogger('phe.auth')

def digest(token):
    return hashlib.sha256(token.encode('utf-8')).digest()

def now():
    return datetime.now(timezone.utc)

def bad(message, status=400):
    raise HTTPException(status_code=status, detail=message)

def get_allowed_origins(request: Request | None = None) -> set[str]:
    origins = set(DEFAULT_ALLOWED_ORIGINS)
    if ORIGIN:
        origins.add(ORIGIN.lower().rstrip('/'))
    raw_allowed = os.getenv('ALLOWED_ORIGINS', '')
    if raw_allowed:
        for item in raw_allowed.split(','):
            cleaned = item.strip().lower().rstrip('/')
            if cleaned:
                origins.add(cleaned)
    if request is not None:
        host = (request.headers.get('host') or '').split(':')[0].strip().lower()
        if host:
            if host in ('localhost', '127.0.0.1', 'testserver'):
                origin_header = request.headers.get('origin', '')
                if origin_header:
                    parsed = urlsplit(origin_header)
                    if parsed.hostname in ('localhost', '127.0.0.1', 'testserver'):
                        origins.add(origin_header.lower().rstrip('/'))
                origins.add(f'http://{host}')
                origins.add(f'https://{host}')
            elif host == 'phephim.ai' or host.endswith('.phephim.ai'):
                origins.add(f'https://{host}')
            elif host == 'phephim.vercel.app' or (host.startswith('phephim-') and host.endswith('.vercel.app')):
                origins.add(f'https://{host}')
    return origins

def extract_origin(request: Request) -> str | None:
    origin = request.headers.get('origin')
    if origin:
        return origin.strip().lower().rstrip('/')
    referer = request.headers.get('referer')
    if referer:
        parsed = urlsplit(referer)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}".lower().rstrip('/')
    return None

def is_allowed_origin(origin: str | None, request: Request | None = None) -> bool:
    if not origin:
        return False
    norm = origin.strip().lower().rstrip('/')
    return norm in get_allowed_origins(request)

def check_origin(request: Request):
    origin = extract_origin(request)
    if not origin or not is_allowed_origin(origin, request):
        bad('Yêu cầu không hợp lệ.', 403)

def get_request_origin(request: Request | None = None) -> str:
    if request is not None:
        extracted = extract_origin(request)
        if extracted and is_allowed_origin(extracted, request):
            return extracted
        host = (request.headers.get('host') or '').strip()
        proto = request.headers.get('x-forwarded-proto', 'https')
        if host:
            candidate = f"{proto}://{host}".rstrip('/')
            if is_allowed_origin(candidate, request):
                return candidate
    return PRIMARY_ORIGIN or ORIGIN

def limit(request, kind, maximum, minutes, db=None):
    # Hash the address before storing it. Trust the direct peer unless a trusted
    # reverse proxy explicitly replaces request.client via Uvicorn configuration.
    peer = request.client.host if request.client else 'unknown'
    key = hashlib.sha256((kind + ':' + peer).encode()).hexdigest()
    sql = text('''INSERT INTO auth_rate_limits(bucket, attempts, expires_at)
        VALUES (:key, 1, now() + (:minutes * interval '1 minute'))
        ON CONFLICT(bucket) DO UPDATE SET
          attempts = CASE WHEN auth_rate_limits.expires_at <= now() THEN 1 ELSE auth_rate_limits.attempts + 1 END,
          expires_at = CASE WHEN auth_rate_limits.expires_at <= now() THEN now() + (:minutes * interval '1 minute') ELSE auth_rate_limits.expires_at END
        RETURNING attempts''')
    params = {'key': key, 'minutes': minutes}
    if db is not None:
        count = db.execute(sql, params).scalar_one()
    else:
        with engine.begin() as conn:
            count = conn.execute(sql, params).scalar_one()
    if count > maximum:
        bad('Quá nhiều yêu cầu. Vui lòng thử lại sau.', 429)

def require_user(request, csrf=False):
    token = request.cookies.get(COOKIE, '')
    if not token or len(token) > 128:
        bad('Vui lòng đăng nhập.', 401)
    with engine.connect() as db:
        row = db.execute(text('''SELECT u.id, u.username, u.email, u.email_verified_at, s.csrf_token_hash
            FROM user_sessions s JOIN users u ON u.id=s.user_id
            WHERE s.token_hash=:token AND s.revoked_at IS NULL AND s.expires_at>now()'''), {'token':digest(token)}).mappings().first()
    if not row:
        bad('Phiên đăng nhập đã hết hạn.', 401)
    if csrf:
        check_origin(request)
        header = request.headers.get('x-csrf-token', '')
        cookie = request.cookies.get(CSRF_COOKIE, '')
        if not header or len(header) > 128 or not hmac.compare_digest(header, cookie) or not hmac.compare_digest(digest(header), bytes(row['csrf_token_hash'])):
            bad('Yêu cầu không hợp lệ.', 403)
    return row

def public_user(row) -> PublicUser:
    return {'id':row['id'], 'username':row['username'], 'email':row['email'], 'email_verified':bool(row['email_verified_at'])}

def send_email(address, subject, body):
    host, sender = os.getenv('SMTP_HOST'), os.getenv('SMTP_FROM')
    if not host or not sender:
        return False
    msg = EmailMessage(); msg['From'] = sender; msg['To'] = address; msg['Subject'] = subject; msg.set_content(body)
    try:
        with smtplib.SMTP(host, int(os.getenv('SMTP_PORT', '587')), timeout=10) as smtp:
            smtp.starttls()
            if os.getenv('SMTP_USER'):
                smtp.login(os.environ['SMTP_USER'], os.environ.get('SMTP_PASSWORD', ''))
            smtp.send_message(msg)
        return True
    except (OSError, smtplib.SMTPException, ValueError):
        logger.warning('Email delivery failed')
        return False

def issue_email_token(user_id, email, kind, request: Request | None = None):
    # Table and URL are chosen internally, never from user input.
    token = secrets.token_urlsafe(32)
    table = 'password_reset_tokens' if kind == 'reset' else 'email_verification_tokens'
    expiry = now() + timedelta(minutes=30 if kind == 'reset' else 1440)
    with engine.begin() as db:
        db.execute(text(f'UPDATE {table} SET used_at=now() WHERE user_id=:uid AND used_at IS NULL'), {'uid':user_id})
        db.execute(text(f'INSERT INTO {table}(user_id,token_hash,expires_at) VALUES (:uid,:token,:expiry)'), {'uid':user_id,'token':digest(token),'expiry':expiry})
    path = '/dat-lai-mat-khau/' if kind == 'reset' else '/xac-minh-email/'
    base_origin = get_request_origin(request)
    return send_email(email, 'PHE PHIM AI', f'Mở liên kết sau để tiếp tục: {base_origin}{path}#token={token}\nLiên kết chỉ sử dụng một lần.')


import hmac
import os
from fastapi import HTTPException, Request
from app.services.auth import require_user

DEFAULT_ADMIN_EMAILS = {
    'letan.offcial@gmail.com',
    'tcmedia.copyright@gmail.com',
}


def get_admin_emails() -> set[str]:
    raw = os.getenv('ADMIN_EMAILS', '')
    emails = {e.strip().lower() for e in raw.split(',') if e.strip()}
    return emails | DEFAULT_ADMIN_EMAILS


def get_admin_api_key() -> str:
    return os.getenv('ADMIN_API_KEY', os.getenv('PHE_ADMIN_KEY', '')).strip()


def require_admin(request: Request, csrf: bool = False):
    """Enforces admin authorization via:

    1. X-Admin-Key header matching ADMIN_API_KEY
    2. Valid logged-in session belonging to an admin email address
    """
    admin_key = get_admin_api_key()
    header_key = request.headers.get('x-admin-key', '').strip()

    if admin_key and header_key and hmac.compare_digest(header_key, admin_key):
        return {'id': 0, 'username': 'admin_api_key', 'email': 'admin@system', 'is_admin': True}

    try:
        user = require_user(request, csrf=csrf)
    except HTTPException as exc:
        if header_key:
            raise HTTPException(403, 'Khóa quản trị không hợp lệ.')
        raise exc

    admin_emails = get_admin_emails()
    user_email = (user.get('email') or '').strip().lower()
    if user_email not in admin_emails:
        raise HTTPException(403, 'Tài khoản không có quyền quản trị viên.')

    return dict(user)

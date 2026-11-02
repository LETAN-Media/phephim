import os
import secrets
from datetime import timedelta
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError, VerificationError
from fastapi import APIRouter, Request, Response
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from app.core.config import COOKIE, CSRF_COOKIE
from app.core.database import engine
from app.schemas.auth import Register, Login, EmailInput, Reset, TokenInput, ChangePassword, Profile
from app.schemas.validation import valid_email, valid_password, valid_username
from app.services.auth import bad, check_origin, digest, issue_email_token, limit, now, public_user, require_user

hasher = PasswordHasher()

def me(request: Request): return public_user(require_user(request))

def profile(data: Profile, request: Request):
    user = require_user(request, True); username = data.username.strip()
    if not valid_username(username): bad('Tên người dùng không hợp lệ.')
    try:
        with engine.begin() as db:
            db.execute(text('UPDATE users SET username=:username,updated_at=now() WHERE id=:id'), {'username':username,'id':user['id']})
    except IntegrityError: bad('Tên người dùng đã được sử dụng.', 409)
    return {'message':'Đã cập nhật hồ sơ.'}


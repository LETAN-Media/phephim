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

def register(data: Register, request: Request):
    check_origin(request); limit(request, 'register', 10, 60)
    username, email = data.username.strip(), data.email.strip().lower()
    if not valid_username(username): bad('Tên người dùng cần 3–32 ký tự chữ, số hoặc dấu gạch dưới.')
    if not valid_email(email): bad('Email không hợp lệ.')
    if not valid_password(data.password): bad('Mật khẩu cần ít nhất 10 ký tự.')
    if not data.terms: bad('Vui lòng đồng ý với điều khoản.')
    try:
        with engine.begin() as db:
            uid = db.execute(text('INSERT INTO users(username,email,password_hash) VALUES (:username,:email,:password) RETURNING id'), {'username':username,'email':email,'password':hasher.hash(data.password)}).scalar_one()
    except IntegrityError:
        bad('Email hoặc tên người dùng đã được sử dụng.', 409)
    delivered = issue_email_token(uid, email, 'verify') if os.getenv('SMTP_HOST') and os.getenv('SMTP_FROM') else False
    return {'message':'Tạo tài khoản thành công.', 'verification_email_sent':delivered}

def login(data: Login, request: Request, response: Response):
    check_origin(request); limit(request, 'login', 15, 15)
    identifier = data.identifier.strip().lower()
    with engine.connect() as db:
        row = db.execute(text('SELECT id,username,email,email_verified_at,password_hash FROM users WHERE lower(email)=:identifier OR lower(username)=:identifier LIMIT 1'), {'identifier':identifier}).mappings().first()
    if not row: bad('Thông tin đăng nhập không chính xác.', 401)
    try: verified = hasher.verify(row['password_hash'], data.password)
    except (VerifyMismatchError, VerificationError, InvalidHashError): verified = False
    if not verified: bad('Thông tin đăng nhập không chính xác.', 401)
    token, csrf = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    duration = timedelta(days=30 if data.remember else 1)
    with engine.begin() as db:
        db.execute(text('INSERT INTO user_sessions(user_id,token_hash,csrf_token_hash,expires_at) VALUES (:uid,:token,:csrf,:expiry)'), {'uid':row['id'],'token':digest(token),'csrf':digest(csrf),'expiry':now()+duration})
    opts = {'secure':True,'samesite':'lax','path':'/'}
    if data.remember: opts['max_age'] = int(duration.total_seconds())
    response.set_cookie(COOKIE, token, httponly=True, **opts)
    response.set_cookie(CSRF_COOKIE, csrf, httponly=False, **opts)
    return public_user(row)

def logout(request: Request, response: Response):
    require_user(request, True)
    with engine.begin() as db:
        db.execute(text('UPDATE user_sessions SET revoked_at=now() WHERE token_hash=:token'), {'token':digest(request.cookies[COOKIE])})
    response.delete_cookie(COOKIE, path='/', secure=True, httponly=True, samesite='lax')
    response.delete_cookie(CSRF_COOKIE, path='/', secure=True, samesite='lax')
    return {'message':'Đã đăng xuất.'}

def change_password(data: ChangePassword, request: Request):
    user = require_user(request, True); limit(request, 'change-password', 15, 15)
    if not valid_password(data.new_password): bad('Mật khẩu mới cần ít nhất 10 ký tự.')
    with engine.begin() as db:
        old = db.execute(text('SELECT password_hash FROM users WHERE id=:id FOR UPDATE'), {'id':user['id']}).scalar_one()
        try: verified = hasher.verify(old, data.current_password)
        except (VerifyMismatchError, VerificationError, InvalidHashError): verified = False
        if not verified: bad('Mật khẩu hiện tại không chính xác.', 400)
        db.execute(text('UPDATE users SET password_hash=:password,updated_at=now() WHERE id=:id'), {'password':hasher.hash(data.new_password),'id':user['id']})
        db.execute(text('UPDATE user_sessions SET revoked_at=now() WHERE user_id=:id'), {'id':user['id']})
    return {'message':'Đã đổi mật khẩu. Vui lòng đăng nhập lại.'}

def forgot(data: EmailInput, request: Request):
    check_origin(request); limit(request, 'forgot', 10, 60)
    email = data.email.strip().lower()
    with engine.connect() as db:
        user = db.execute(text('SELECT id,email FROM users WHERE lower(email)=:email'), {'email':email}).mappings().first()
    if user and os.getenv('SMTP_HOST') and os.getenv('SMTP_FROM'):
        issue_email_token(user['id'], user['email'], 'reset')
    return {'message':'Nếu email hợp lệ, hướng dẫn sẽ được gửi tới hộp thư của bạn.'}

def reset(data: Reset, request: Request):
    check_origin(request); limit(request, 'reset', 20, 60)
    if not valid_password(data.password): bad('Mật khẩu cần ít nhất 10 ký tự.')
    with engine.begin() as db:
        row = db.execute(text('UPDATE password_reset_tokens SET used_at=now() WHERE token_hash=:token AND used_at IS NULL AND expires_at>now() RETURNING user_id'), {'token':digest(data.token)}).first()
        if not row: bad('Liên kết không hợp lệ hoặc đã hết hạn.')
        db.execute(text('UPDATE users SET password_hash=:password,updated_at=now() WHERE id=:id'), {'password':hasher.hash(data.password),'id':row[0]})
        db.execute(text('UPDATE user_sessions SET revoked_at=now() WHERE user_id=:id'), {'id':row[0]})
    return {'message':'Đã đặt lại mật khẩu. Vui lòng đăng nhập.'}

def verify(data: TokenInput, request: Request):
    check_origin(request); limit(request, 'verify', 20, 60)
    with engine.begin() as db:
        row = db.execute(text('UPDATE email_verification_tokens SET used_at=now() WHERE token_hash=:token AND used_at IS NULL AND expires_at>now() RETURNING user_id'), {'token':digest(data.token)}).first()
        if not row: bad('Liên kết không hợp lệ hoặc đã hết hạn.')
        db.execute(text('UPDATE users SET email_verified_at=now(),updated_at=now() WHERE id=:id'), {'id':row[0]})
    return {'message':'Email đã được xác minh.'}


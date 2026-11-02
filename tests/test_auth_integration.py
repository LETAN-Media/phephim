"""Opt-in PostgreSQL integration test. Requires both migrations on DATABASE_URL_TEST."""
import os
import secrets
from datetime import datetime, timedelta, timezone

import pytest

if not os.getenv('DATABASE_URL_TEST'):
    pytest.skip('Set DATABASE_URL_TEST to a dedicated migrated PostgreSQL database', allow_module_level=True)
os.environ['DATABASE_URL'] = os.environ['DATABASE_URL_TEST']
os.environ['APP_ORIGIN'] = 'https://testserver'
from fastapi.testclient import TestClient
from sqlalchemy import text
from app.main import app
from app.core.database import engine
from app.services.auth import digest

@pytest.fixture
def client():
    with TestClient(app, base_url='https://testserver', headers={'Origin':'https://testserver'}) as c:
        yield c

def test_real_auth_flow(client):
    suffix=secrets.token_hex(6)
    username='test_'+suffix
    email=username+'@example.com'
    password='correct-horse-1'
    payload={'username':username,'email':email,'password':password,'terms':True}
    uid=None
    try:
        assert client.post('/api/auth/register',json={**payload,'password':'short'}).status_code==400
        assert client.post('/api/auth/register',json=payload).status_code==201
        assert client.post('/api/auth/register',json=payload).status_code==409
        assert client.post('/api/auth/register',json={**payload,'username':'other_'+suffix}).status_code==409
        assert client.post('/api/auth/register',json={**payload,'email':'other_'+email}).status_code==409
        assert client.post('/api/auth/login',json={'identifier':email,'password':'wrong-password'}).status_code==401
        assert client.post('/api/auth/login',json={'identifier':username,'password':password,'remember':True}).status_code==200
        user=client.get('/api/auth/me').json(); uid=user['id']; assert user['email']==email
        assert client.get('/api/users/me').json()['id']==uid
        assert client.patch('/api/users/me',json={'username':'new_'+suffix}).status_code==403
        csrf=client.cookies.get('__Host-phe_csrf')
        assert client.post('/api/auth/change-password',headers={'X-CSRF-Token':csrf},json={'current_password':'wrong','new_password':'new-password-123'}).status_code==400
        assert client.post('/api/auth/change-password',headers={'X-CSRF-Token':csrf},json={'current_password':password,'new_password':'new-password-123'}).status_code==200
        assert client.get('/api/auth/me').status_code==401
        assert client.post('/api/auth/login',json={'identifier':email,'password':'new-password-123'}).status_code==200
        csrf=client.cookies.get('__Host-phe_csrf')
        assert client.post('/api/auth/logout',headers={'X-CSRF-Token':csrf}).status_code==200
        assert client.get('/api/auth/me').status_code==401
        assert client.post('/api/auth/forgot-password',json={'email':email}).json()==client.post('/api/auth/forgot-password',json={'email':'missing@example.com'}).json()
        token=secrets.token_urlsafe(32)
        with engine.begin() as db:
            db.execute(text('INSERT INTO password_reset_tokens(user_id,token_hash,expires_at,created_at) VALUES (:uid,:hash,:expires,:created)'),{'uid':uid,'hash':digest(token),'expires':datetime.now(timezone.utc)-timedelta(minutes=1),'created':datetime.now(timezone.utc)-timedelta(hours=1)})
        assert client.post('/api/auth/reset-password',json={'token':token,'password':'another-password-1'}).status_code==400
        valid_token=secrets.token_urlsafe(32)
        verify_token=secrets.token_urlsafe(32)
        with engine.begin() as db:
            for table, value in [('password_reset_tokens',valid_token),('email_verification_tokens',verify_token)]:
                db.execute(text(f'INSERT INTO {table}(user_id,token_hash,expires_at) VALUES (:uid,:hash,:expires)'),{'uid':uid,'hash':digest(value),'expires':datetime.now(timezone.utc)+timedelta(minutes=10)})
        assert client.post('/api/auth/verify-email',json={'token':verify_token}).status_code==200
        assert client.post('/api/auth/verify-email',json={'token':verify_token}).status_code==400
        assert client.post('/api/auth/reset-password',json={'token':valid_token,'password':'another-password-1'}).status_code==200
        assert client.post('/api/auth/reset-password',json={'token':valid_token,'password':'another-password-1'}).status_code==400
        assert client.post('/api/auth/login',json={'identifier':email,'password':'another-password-1'}).status_code==200
        assert client.get('/api/auth/me').json()['email_verified'] is True
        assert client.get('/.env').status_code==404
        assert client.get('/api/users/999999').status_code==404
    finally:
        with engine.begin() as db:
            db.execute(text('DELETE FROM users WHERE email=:email'),{'email':email})

"""Tests for origin validation supporting custom domains (phephim.ai) and Vercel domains."""
import os
import pytest
from fastapi import HTTPException, Request
from starlette.datastructures import Headers
from app.services.auth import (
    check_origin,
    extract_origin,
    get_allowed_origins,
    get_request_origin,
    is_allowed_origin,
)

def make_request(headers_dict: dict[str, str]) -> Request:
    raw_headers = [(k.lower().encode('latin-1'), v.encode('latin-1')) for k, v in headers_dict.items()]
    scope = {
        'type': 'http',
        'method': 'POST',
        'path': '/api/auth/login',
        'headers': raw_headers,
    }
    return Request(scope)

def test_default_allowed_origins():
    origins = get_allowed_origins()
    assert 'https://www.phephim.ai' in origins
    assert 'https://phephim.ai' in origins
    assert 'https://phephim.vercel.app' in origins

def test_origin_validation_custom_domains():
    req_www = make_request({'host': 'www.phephim.ai', 'origin': 'https://www.phephim.ai'})
    assert is_allowed_origin('https://www.phephim.ai', req_www)
    check_origin(req_www)  # Should not raise

    req_apex = make_request({'host': 'phephim.ai', 'origin': 'https://phephim.ai'})
    assert is_allowed_origin('https://phephim.ai', req_apex)
    check_origin(req_apex)

    req_vercel = make_request({'host': 'phephim.vercel.app', 'origin': 'https://phephim.vercel.app'})
    assert is_allowed_origin('https://phephim.vercel.app', req_vercel)
    check_origin(req_vercel)

def test_origin_validation_preview_vercel_deployments():
    req_preview = make_request({
        'host': 'phephim-git-feat-test-le-tans-projects.vercel.app',
        'origin': 'https://phephim-git-feat-test-le-tans-projects.vercel.app',
    })
    assert is_allowed_origin('https://phephim-git-feat-test-le-tans-projects.vercel.app', req_preview)
    check_origin(req_preview)

def test_origin_validation_rejects_malicious_origins():
    req_attack = make_request({'host': 'www.phephim.ai', 'origin': 'https://evil.com'})
    assert not is_allowed_origin('https://evil.com', req_attack)
    with pytest.raises(HTTPException) as exc_info:
        check_origin(req_attack)
    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == 'Yêu cầu không hợp lệ.'

    # Attacker on an unrelated Vercel app
    req_other_vercel = make_request({'host': 'www.phephim.ai', 'origin': 'https://evil.vercel.app'})
    assert not is_allowed_origin('https://evil.vercel.app', req_other_vercel)
    with pytest.raises(HTTPException) as exc_info:
        check_origin(req_other_vercel)
    assert exc_info.value.status_code == 403

    # Spoofed domain name
    req_spoof = make_request({'host': 'www.phephim.ai', 'origin': 'https://notphephim.ai'})
    assert not is_allowed_origin('https://notphephim.ai', req_spoof)
    with pytest.raises(HTTPException) as exc_info:
        check_origin(req_spoof)
    assert exc_info.value.status_code == 403

def test_referer_fallback_when_origin_missing():
    req_referer = make_request({
        'host': 'www.phephim.ai',
        'referer': 'https://www.phephim.ai/dang-nhap/',
    })
    assert extract_origin(req_referer) == 'https://www.phephim.ai'
    check_origin(req_referer)  # Should not raise

    req_bad_referer = make_request({
        'host': 'www.phephim.ai',
        'referer': 'https://evil.com/phishing',
    })
    assert extract_origin(req_bad_referer) == 'https://evil.com'
    with pytest.raises(HTTPException) as exc_info:
        check_origin(req_bad_referer)
    assert exc_info.value.status_code == 403

def test_get_request_origin():
    req_www = make_request({'host': 'www.phephim.ai', 'origin': 'https://www.phephim.ai'})
    assert get_request_origin(req_www) == 'https://www.phephim.ai'

    req_none = make_request({'host': 'unknown-site.com'})
    assert 'phephim.ai' in get_request_origin(req_none)

def test_api_login_origin_enforcement(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)

    # Malicious origin must return 403 "Yêu cầu không hợp lệ."
    resp_bad = client.post(
        '/api/auth/login',
        headers={'Origin': 'https://evil.com', 'Host': 'www.phephim.ai'},
        json={'identifier': 'user', 'password': 'Password123!'},
    )
    assert resp_bad.status_code == 403
    assert resp_bad.json() == {'detail': 'Yêu cầu không hợp lệ.'}

    # Custom domain Origin: https://www.phephim.ai passes origin check!
    # (Fails auth check with 401 instead of origin 403)
    resp_custom = client.post(
        '/api/auth/login',
        headers={'Origin': 'https://www.phephim.ai', 'Host': 'www.phephim.ai'},
        json={'identifier': 'nonexistent_test_user_xyz', 'password': 'Password123!'},
    )
    assert resp_custom.status_code == 401
    assert resp_custom.json() == {'detail': 'Thông tin đăng nhập không chính xác.'}

    # Vercel domain Origin: https://phephim.vercel.app passes origin check!
    resp_vercel = client.post(
        '/api/auth/login',
        headers={'Origin': 'https://phephim.vercel.app', 'Host': 'phephim.vercel.app'},
        json={'identifier': 'nonexistent_test_user_xyz', 'password': 'Password123!'},
    )
    assert resp_vercel.status_code == 401
    assert resp_vercel.json() == {'detail': 'Thông tin đăng nhập không chính xác.'}

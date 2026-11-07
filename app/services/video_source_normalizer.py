import ipaddress
import os
import re
import urllib.parse
from urllib.parse import parse_qs, quote_plus, unquote, urlencode, urlsplit, urlunsplit

DEFAULT_PLAYER_IFRAME_HOSTS = {
    'www.youtube.com',
    'youtube.com',
    'm.youtube.com',
    'youtu.be',
    'www.youtube-nocookie.com',
    'youtube-nocookie.com',
    'www.facebook.com',
    'facebook.com',
    'web.facebook.com',
    'm.facebook.com',
    'fb.watch',
}

YOUTUBE_HOSTS = {
    'www.youtube.com',
    'youtube.com',
    'm.youtube.com',
    'youtu.be',
    'www.youtube-nocookie.com',
    'youtube-nocookie.com',
}

FACEBOOK_HOSTS = {
    'www.facebook.com',
    'facebook.com',
    'web.facebook.com',
    'm.facebook.com',
    'fb.watch',
}

YOUTUBE_ID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')
FB_VIDEO_PATH_RE = re.compile(r'/(?:videos|reel|watch)/([0-9]+)')
FB_USER_VIDEO_RE = re.compile(r'/[^/]+/videos/([0-9]+)')


def get_allowed_iframe_hosts() -> set[str]:
    raw = os.getenv('PLAYER_IFRAME_HOSTS', '')
    hosts = {h.strip().lower() for h in raw.split(',') if h.strip()}
    return hosts | DEFAULT_PLAYER_IFRAME_HOSTS if hosts else set(DEFAULT_PLAYER_IFRAME_HOSTS)


def is_private_or_invalid_host(host: str) -> bool:
    if not host or host.lower() == 'localhost':
        return True
    try:
        ip = ipaddress.ip_address(host.strip('[]'))
        return (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        )
    except ValueError:
        return False


def parse_time_param(raw: str | None) -> int | None:
    if not raw:
        return None
    raw = raw.strip().lower()
    if raw.isdigit():
        return int(raw)
    match = re.fullmatch(r'(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?', raw)
    if not match:
        return None
    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)
    total = hours * 3600 + minutes * 60 + seconds
    return total if total > 0 else None


def normalize_youtube(url: str) -> dict | None:
    parts = urlsplit(url)
    host = (parts.hostname or '').lower()
    if host not in YOUTUBE_HOSTS:
        return None

    path = parts.path
    query = parse_qs(parts.query)
    video_id = None

    if host == 'youtu.be':
        candidate = path.lstrip('/').split('/')[0] if path.lstrip('/') else ''
        if YOUTUBE_ID_RE.match(candidate):
            video_id = candidate
    else:
        if path == '/watch':
            candidate = query.get('v', [''])[0]
            if YOUTUBE_ID_RE.match(candidate):
                video_id = candidate
        elif path.startswith(('/embed/', '/v/', '/shorts/')):
            segments = [s for s in path.split('/') if s]
            if len(segments) >= 2 and YOUTUBE_ID_RE.match(segments[1]):
                video_id = segments[1]

    if not video_id:
        return None

    start_raw = query.get('start', [query.get('t', [''])[0]])[0]
    start_seconds = parse_time_param(start_raw)

    query_params = {'enablejsapi': '1'}
    if start_seconds and start_seconds > 0:
        query_params['start'] = str(start_seconds)

    embed_query = '?' + urlencode(query_params)
    embed_url = f'https://www.youtube.com/embed/{video_id}{embed_query}'
    external_url = f'https://www.youtube.com/watch?v={video_id}'

    return {
        'platform': 'youtube',
        'media_type': 'iframe',
        'embed_url': embed_url,
        'external_url': external_url,
        'video_id': video_id,
        'original_url': url,
    }


def normalize_facebook(url: str) -> dict | None:
    parts = urlsplit(url)
    host = (parts.hostname or '').lower()
    if host not in FACEBOOK_HOSTS:
        return None

    canonical_target = None
    query = parse_qs(parts.query)

    # Check if this is already a plugin embed URL
    if parts.path.startswith('/plugins/video.php'):
        href = query.get('href', [''])[0]
        if href:
            inner_parts = urlsplit(href)
            inner_host = (inner_parts.hostname or '').lower()
            if inner_host in FACEBOOK_HOSTS and inner_parts.scheme == 'https':
                canonical_target = href

    if not canonical_target:
        # Standard facebook video URLs
        clean_url = urlunsplit(('https', 'www.facebook.com', parts.path.rstrip('/'), parts.query, ''))
        # Check known patterns: /watch/?v=ID, /videos/ID, /{user}/videos/ID, /reel/ID, fb.watch/CODE
        if host == 'fb.watch':
            code = parts.path.strip('/')
            if code and re.match(r'^[A-Za-z0-9_-]+$', code):
                canonical_target = f'https://fb.watch/{code}/'
        elif query.get('v'):
            v_id = query.get('v')[0]
            if v_id.isdigit():
                canonical_target = f'https://www.facebook.com/watch/?v={v_id}'
        elif FB_VIDEO_PATH_RE.search(parts.path) or FB_USER_VIDEO_RE.search(parts.path):
            canonical_target = clean_url
        elif parts.path.startswith('/'):
            # Allow any public video path on facebook
            canonical_target = clean_url

    if not canonical_target:
        return None

    encoded_href = quote_plus(canonical_target)
    embed_url = f'https://www.facebook.com/plugins/video.php?href={encoded_href}&show_text=false'
    external_url = canonical_target

    return {
        'platform': 'facebook',
        'media_type': 'iframe',
        'embed_url': embed_url,
        'external_url': external_url,
        'video_id': None,
        'original_url': url,
    }


def normalize_direct_stream(url: str) -> dict | None:
    parts = urlsplit(url)
    path_lower = parts.path.lower()

    if path_lower.endswith('.mp4') or '/v1/stream/' in path_lower:
        media_type = 'mp4'
    elif '.m3u8' in path_lower:
        media_type = 'hls'
    elif '.mpd' in path_lower:
        media_type = 'dash'
    else:
        return None

    return {
        'platform': 'direct',
        'media_type': media_type,
        'embed_url': url,
        'external_url': url,
        'video_id': None,
        'original_url': url,
    }


def normalize_source_url(url: str, platform_hint: str | None = None) -> dict:
    """Validate and normalize a video source URL.

    Raises ValueError with descriptive Vietnamese message if invalid.
    """
    if not isinstance(url, str) or not url.strip():
        raise ValueError('URL nguồn không được để trống.')

    if any(c in url for c in ('\r', '\n', '\x00', '\\')):
        raise ValueError('URL chứa ký tự không hợp lệ.')

    clean = url.strip()

    # Local static demo media
    if clean.startswith('/static/'):
        if clean.startswith('//') or '..' in clean:
            raise ValueError('Đường dẫn static không hợp lệ.')
        direct = normalize_direct_stream(clean)
        if direct:
            return direct
        raise ValueError('Định dạng tệp static không được hỗ trợ (cần .mp4, .m3u8 hoặc .mpd).')

    parts = urlsplit(clean)
    if parts.scheme != 'https':
        raise ValueError('Nguồn video bắt buộc phải sử dụng giao thức HTTPS an toàn.')

    if parts.username or parts.password:
        raise ValueError('URL không được chứa thông tin xác thực.')

    host = (parts.hostname or '').lower()
    if not host or is_private_or_invalid_host(host):
        raise ValueError('Địa chỉ máy chủ của nguồn không hợp lệ hoặc bị cấm.')

    if parts.port not in (None, 443):
        raise ValueError('Cổng kết nối không hợp lệ (chỉ cho phép cổng 443).')

    hint = (platform_hint or '').lower().strip()

    # Try YouTube
    if hint in ('youtube', 'yt') or host in YOUTUBE_HOSTS:
        yt = normalize_youtube(clean)
        if yt:
            return yt
        if hint in ('youtube', 'yt'):
            raise ValueError('Không nhận diện được video YouTube hợp lệ từ liên kết đã cung cấp.')

    # Try Facebook
    if hint in ('facebook', 'fb') or host in FACEBOOK_HOSTS:
        fb = normalize_facebook(clean)
        if fb:
            return fb
        if hint in ('facebook', 'fb'):
            raise ValueError('Không nhận diện được video Facebook hợp lệ từ liên kết đã cung cấp.')

    # Try Direct media (mp4, hls, dash)
    direct = normalize_direct_stream(clean)
    if direct:
        return direct

    # If platform was explicitly specified as iframe or host is in allowed iframe hosts
    allowed_hosts = get_allowed_iframe_hosts()
    if hint == 'iframe' or host in allowed_hosts:
        if host not in allowed_hosts:
            raise ValueError(f'Tên miền {host} chưa nằm trong danh sách iframe được phép.')
        return {
            'platform': 'iframe',
            'media_type': 'iframe',
            'embed_url': clean,
            'external_url': clean,
            'video_id': None,
            'original_url': clean,
        }

    raise ValueError(
        'Định dạng nguồn không được hỗ trợ. Vui lòng cung cấp link YouTube, Facebook hoặc luồng MP4/HLS/DASH.'
    )

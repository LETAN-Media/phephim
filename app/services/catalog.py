import json
import logging
from app.core.config import ROOT

logger = logging.getLogger('phe.catalog')

MOVIE_ALIASES = {
    'phim': 'den-tham-anh-em-nghia-hiep-cua-ban-trai-bat-ngo-bi-cuon-vao-am-muu-tinh-vi',
}

def get_db_movies() -> list[dict]:
    """Dynamically load published and draft movies directly from Neon DB."""
    try:
        from app.core.database import engine
        from sqlalchemy import text
        with engine.connect() as db:
            rows = db.execute(
                text('''
                    SELECT p.movie_slug, p.title, p.bvid, p.published_at, p.status,
                           v.thumbnail_url, v.duration_display,
                           m.approved_title
                    FROM toolnet_auto.publish_records p
                    LEFT JOIN toolnet_auto.bilibili_videos v ON p.bvid = v.bvid
                    LEFT JOIN toolnet_auto.video_metadata m ON p.bvid = m.bvid
                    WHERE p.status IN ('PUBLISHED', 'DRAFT')
                    ORDER BY p.published_at DESC
                ''')
            ).mappings().all()

            db_movies = []
            seen_slugs = set()
            for r in rows:
                slug = r['movie_slug']
                if slug in seen_slugs:
                    continue
                seen_slugs.add(slug)
                poster = r.get('thumbnail_url') or ''
                is_draft = (r.get('status') == 'DRAFT')
                display_title = r.get('approved_title') or r.get('title') or slug
                db_movies.append({
                    'slug': slug,
                    'title': display_title,
                    'year': r['published_at'].year if r.get('published_at') else 2026,
                    'country': 'Trung Quốc',
                    'genre': 'Thuyết Minh, Phim Lẻ',
                    'rating': 8.5,
                    'status': 'Phim lẻ',
                    'poster': poster,
                    'backdrop': poster,
                    'bvid': r.get('bvid'),
                    'demo': is_draft,
                    'draft': is_draft,
                })
            return db_movies
    except Exception as e:
        logger.error("Catalog DB lookup error: %s", e, exc_info=True)
        return []

def catalog():
    base = {}
    try:
        data_path = ROOT / 'app/data/movies.json'
        if data_path.exists():
            base = {movie['slug']: movie for movie in json.loads(data_path.read_text(encoding='utf-8'))}
    except Exception:
        pass

    for dm in get_db_movies():
        base[dm['slug']] = dm

    return base

def movie_for_slug(slug):
    target_slug = MOVIE_ALIASES.get(slug, slug)
    m = catalog().get(target_slug)
    if m:
        return m
    try:
        from app.core.database import engine
        from sqlalchemy import text
        with engine.connect() as db:
            row = db.execute(
                text('''
                    SELECT p.movie_slug, p.title, p.bvid, p.published_at, p.status,
                           v.thumbnail_url, m.approved_title
                    FROM toolnet_auto.publish_records p
                    LEFT JOIN toolnet_auto.bilibili_videos v ON p.bvid = v.bvid
                    LEFT JOIN toolnet_auto.video_metadata m ON p.bvid = m.bvid
                    WHERE p.movie_slug = :slug OR p.movie_slug = :target_slug
                    ORDER BY (p.movie_slug = :target_slug) DESC
                    LIMIT 1
                '''),
                {'slug': slug, 'target_slug': target_slug}
            ).mappings().first()
            if row:
                poster = row.get('thumbnail_url') or ''
                is_draft = (row.get('status') == 'DRAFT')
                display_title = row.get('approved_title') or row.get('title') or target_slug
                return {
                    'slug': row['movie_slug'],
                    'title': display_title,
                    'year': row['published_at'].year if row.get('published_at') else 2026,
                    'country': 'Trung Quốc',
                    'genre': 'Thuyết Minh, Phim Lẻ',
                    'rating': 8.5,
                    'status': 'Phim lẻ',
                    'poster': poster,
                    'backdrop': poster,
                    'bvid': row.get('bvid'),
                    'demo': is_draft,
                    'draft': is_draft,
                }
            src = db.execute(
                text('SELECT movie_slug, label FROM movie_sources WHERE movie_slug = :slug OR movie_slug = :target_slug LIMIT 1'),
                {'slug': slug, 'target_slug': target_slug}
            ).mappings().first()
            if src:
                return {
                    'slug': src['movie_slug'],
                    'title': src['movie_slug'].replace('-', ' ').title(),
                    'year': 2026,
                    'country': 'Trung Quốc',
                    'genre': 'Thuyết Minh, Phim Lẻ',
                    'rating': 8.5,
                    'status': 'Phim lẻ',
                    'poster': '',
                    'backdrop': '',
                    'demo': False,
                    'draft': False,
                }
    except Exception as e:
        logger.error("Database lookup error in movie_for_slug(%s): %s", slug, e, exc_info=True)
    return None

def get_public_movies():
    return [m for m in catalog().values() if not m.get('demo')]

def get_movies_by_category(category_key: str):
    movies = get_public_movies()
    if category_key == 'phim-bo':
        return [m for m in movies if 'mùa' in (m.get('status') or '').lower() or m.get('status') == 'Phim bộ']
    if category_key == 'phim-le':
        return [m for m in movies if m.get('status') == 'Phim lẻ']
    if category_key == 'phim-ngan':
        return []
    return []

def get_genre_catalog():
    movies = get_public_movies()
    genres = {}
    for m in movies:
        g = (m.get('genre') or '').strip()
        if g:
            genres.setdefault(g, []).append(m)
    return genres

CATEGORY_META = {
    'phim-bo': {
        'title': 'Phim Bộ Đặc Sắc Tuyển Chọn – PHE PHIM AI',
        'h1': 'Phim Bộ',
        'eyebrow': 'KHÁM PHÁ ĐIỆN ẢNH',
        'description': 'Khám phá các series phim bộ đặc sắc, phim truyền hình nhiều mùa hấp dẫn với chất lượng cao tại PHE PHIM AI.',
        'canonical': 'https://phephim.vercel.app/phim-bo/',
        'noindex': False,
    },
    'phim-le': {
        'title': 'Phim Lẻ Hay & Bom Tấn Tuyển Chọn – PHE PHIM AI',
        'h1': 'Phim Lẻ',
        'eyebrow': 'KHÁM PHÁ ĐIỆN ẢNH',
        'description': 'Thưởng thức tuyển tập phim lẻ bom tấn, phim điện ảnh chiếu rạp đỉnh cao từ khắp thế giới trên PHE PHIM AI.',
        'canonical': 'https://phephim.vercel.app/phim-le/',
        'noindex': False,
    },
    'phim-ngan': {
        'title': 'Phim Ngắn Nghệ Thuật Chọn Lọc – PHE PHIM AI',
        'h1': 'Phim Ngắn',
        'eyebrow': 'KHÁM PHÁ ĐIỆN ẢNH',
        'description': 'Khám phá những thước phim ngắn ấn tượng và giàu cảm xúc tại PHE PHIM AI. Danh mục đang được cập nhật thêm nội dung mới.',
        'canonical': 'https://phephim.vercel.app/phim-ngan/',
        'noindex': True,
    },
    'the-loai': {
        'title': 'Thể Loại Phim Đa Dạng – PHE PHIM AI',
        'h1': 'Thể Loại Phim',
        'eyebrow': 'DANH MỤC ĐIỆN ẢNH',
        'description': 'Khám phá các thể loại điện ảnh phong phú: khoa học viễn tưởng, chính kịch, giật gân, hoạt hình, phiêu lưu tại PHE PHIM AI.',
        'canonical': 'https://phephim.vercel.app/the-loai/',
        'noindex': False,
    },
}

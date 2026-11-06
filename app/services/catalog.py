import json
from functools import lru_cache
from app.core.config import ROOT

@lru_cache(maxsize=1)
def catalog():
    return {movie['slug']: movie for movie in json.loads((ROOT / 'app/data/movies.json').read_text(encoding='utf-8'))}

def movie_for_slug(slug):
    return catalog().get(slug)

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

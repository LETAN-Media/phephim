import json
from functools import lru_cache
from app.core.config import ROOT

@lru_cache(maxsize=1)
def catalog():
    return {movie['slug']: movie for movie in json.loads((ROOT / 'app/data/movies.json').read_text(encoding='utf-8'))}

def movie_for_slug(slug):
    return catalog().get(slug)

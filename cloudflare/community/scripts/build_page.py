"""Build the standalone Community page from its Jinja components."""
from pathlib import Path
from types import SimpleNamespace
import sys
from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parents[3]
SITE_ROOT = ROOT if (ROOT / 'frontend/templates/base.html').is_file() else ROOT.parents[1]
environment = Environment(loader=FileSystemLoader([ROOT / 'frontend/templates', SITE_ROOT / 'frontend/templates']), autoescape=select_autoescape(['html']))
request = SimpleNamespace(url=SimpleNamespace(path='/cong-dong/'))
page = environment.get_template('community/index.html').render(request=request)
output = ROOT / 'cloudflare/community/public/index.html'
if '--check' in sys.argv:
    if not output.exists() or output.read_text(encoding='utf-8') != page:
        raise SystemExit('Community static page is out of date; run scripts/build_page.py')
else:
    output.write_text(page, encoding='utf-8')

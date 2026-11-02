"""Check PostgreSQL connectivity or apply reviewed, non-destructive migrations."""
import argparse
import os
from pathlib import Path
import psycopg
from dotenv import load_dotenv

root = Path(__file__).resolve().parent.parent
load_dotenv(root / '.env')
url = os.getenv('DATABASE_URL')
if not url:
    raise SystemExit('DATABASE_URL is not configured')
parser = argparse.ArgumentParser()
parser.add_argument('action', choices=('check', 'migrate'))
args = parser.parse_args()
try:
    with psycopg.connect(url, connect_timeout=10, autocommit=True) as conn:
        with conn.cursor() as cursor:
            cursor.execute('SELECT 1')
            if cursor.fetchone()[0] != 1:
                raise RuntimeError('Unexpected database response')
            print('Database connection: OK')
            if args.action == 'migrate':
                for file in sorted((root / 'migrations').glob('*.sql')):
                    cursor.execute(file.read_text(encoding='utf-8'), prepare=False)
                    print(f'Applied: {file.name}')
except Exception as exc:
    # Driver exceptions can contain connection details; avoid logging them.
    raise SystemExit(f'Database operation failed ({type(exc).__name__}); check connection and migration configuration.') from None

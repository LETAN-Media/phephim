# PHE PHIM AI – Authentication

The application serves the website and API together on `127.0.0.1:8080` using the existing PostgreSQL URL in `.env`. The Cloudflare Tunnel points at this port and supplies HTTPS. Do not expose a separate static server: it may serve `.env`. The FastAPI static handler denies dotfiles and only serves allowed file extensions.

## VPS setup

From the project directory, with network access and Python 3.10+:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Set `APP_ORIGIN` in `.env` to the exact public HTTPS origin, with no path or trailing slash. Keep the existing `DATABASE_URL`; its Neon URL should require TLS (`sslmode=require` or stronger). Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER` and `SMTP_PASSWORD` for an SMTP server using STARTTLS. Without SMTP, registration and login work but verification and reset emails cannot be delivered. Use real service credentials, not example secrets. Restrict `.env` file permissions and server access.

```sh
chmod 600 .env
mkdir -p logs run
nohup .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8080 --no-access-log --no-proxy-headers > logs/web.log 2>&1 < /dev/null &
echo $! > run/web.pid
```

Do not run migrations as part of a normal start or deployment. The existing Neon schema is already in use.

Rate limits are shared via PostgreSQL and currently use the directly connected IP, which is the tunnel proxy IP. Forwarded headers are disabled. Set the exact public `APP_ORIGIN`, including a new origin if the temporary tunnel URL changes, and restart the app. Cookie use requires HTTPS and the same host for frontend and API. Check `run/web.pid` and the listening port before starting to avoid duplicate processes.

## Tests

```sh
.venv/bin/python -m unittest discover -s tests -p 'test_validation.py' -v
```

Create a separate test database and apply the migrations to it. Set `DATABASE_URL_TEST` in the environment, then run:

```sh
.venv/bin/python -m pytest -q tests/test_auth_integration.py
```

The integration test creates and deletes a uniquely named test account. It must not use the production database. Complete browser verification on Safari iPhone over HTTPS, including signup, login, refresh, logout, password change, real email delivery, token expiry and one-time use. The existing movie pages remain publicly accessible.

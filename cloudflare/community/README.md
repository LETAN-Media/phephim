# PHE PHIM AI Community

The community service is a Cloudflare Worker with Durable Objects for chat and support, PostgreSQL for shared sessions and history, and Workers AI for Hưng Creater. The website routes the community paths to this service via `vercel.json`.

`wrangler.production.jsonc` describes the production Worker and contains no credentials. Configure `DATABASE_URL` using Cloudflare's secret manager. Apply the community migrations only after taking and verifying a backup and testing them on a separate database. No migration runs during deployment.

The page is built from `frontend/templates/community/` and the shared site layout. Run `python cloudflare/community/scripts/build_page.py` after changing the template or shared components, and use `--check` to check the generated page. Deploy the Worker after building the page.

Use `npm ci`, `npm test`, `npm run check`, and `npm run build` from this directory to validate the Worker. Production currently uses cleanup-only scheduled jobs; Telegram delivery is disabled.

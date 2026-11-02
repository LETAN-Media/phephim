# Movie playback

The existing catalog remains unchanged. Playback records live in `movie_episodes`, `movie_sources`, and `movie_subtitles`. Existing `watch_progress` is used for a movie without episodes; `episode_watch_progress` stores one position per user, movie and episode. All positions are private to the current session user. The account session and CSRF rules are unchanged.

`migrations/003_movie_playback.sql` is a separate, transactional migration. Apply it only after a verified PostgreSQL 18-compatible backup and testing on a separate database. It inserts only two clearly labelled CC BY demo sources for `big-buck-bunny-demo`; it does not insert sources for commercial movies. Keep backups private: they contain account information.

Only configure media after obtaining distribution permission. Each source needs the existing catalog slug, an optional episode key, a label, one of `mp4`, `hls`, `dash`, or `iframe`, a URL and a sort order. The source is returned to signed-in viewers, so never put credentials or private API keys in it. Direct media URLs must be HTTPS or a same-origin `/static/` URL. iframe sources are disabled by default; set `PLAYER_IFRAME_HOSTS` to a comma-separated list of exact trusted HTTPS hostnames and restart the app. Configure CORS for HLS/DASH manifests, segments and subtitles served from other origins. No test video belongs to a commercial film in production.

Examples for an operator, after substituting licensed content and reviewing rights:

```sql
INSERT INTO movie_episodes (movie_slug, episode_key, title, sort_order)
VALUES ('breaking-bad', 's01e01', 'Tập 1', 1);
INSERT INTO movie_sources (movie_slug, episode_key, label, media_type, url, sort_order, attribution)
VALUES ('breaking-bad', 's01e01', 'Nguồn chính', 'hls', 'https://licensed.example/video/master.m3u8', 1, 'Thông tin bản quyền');
-- movie_subtitles.source_id references the generated movie_sources.id.
```

Movie-only sources use `episode_key = NULL`. Sources are ordered by `sort_order` then ID and may be disabled without deletion. `movie_subtitles` stores WebVTT URLs and language labels. iframe playback is controlled by the external provider; the application cannot reliably save position, detect playback errors, or select its quality or subtitles. Safari uses native HLS; compatible browsers use locally bundled hls.js. DASH uses locally bundled dash.js on compatible browsers. The browser's video controls provide seek, volume, and play/pause; custom controls add speed, quality where available, subtitles and fullscreen.

The test fixture used for playback is an excerpt of **Big Buck Bunny**, © 2008 Blender Foundation, licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Original project: https://peach.blender.org/about/. The short demo is published only as the separately labelled `big-buck-bunny-demo`; it is never assigned to a commercial film.

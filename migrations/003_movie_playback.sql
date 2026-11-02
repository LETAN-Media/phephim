BEGIN;
CREATE TABLE IF NOT EXISTS movie_episodes (
    movie_slug text NOT NULL,
    episode_key text NOT NULL CHECK (episode_key ~ '^[A-Za-z0-9_-]{1,64}$'),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 150),
    sort_order integer NOT NULL DEFAULT 0,
    PRIMARY KEY (movie_slug, episode_key)
);
CREATE TABLE IF NOT EXISTS movie_sources (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    movie_slug text NOT NULL,
    episode_key text,
    label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
    media_type text NOT NULL CHECK (media_type IN ('mp4','hls','dash','iframe')),
    url text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    enabled boolean NOT NULL DEFAULT true,
    attribution text,
    FOREIGN KEY (movie_slug, episode_key) REFERENCES movie_episodes(movie_slug, episode_key) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS movie_sources_lookup_idx ON movie_sources(movie_slug, episode_key, sort_order, id) WHERE enabled;
CREATE TABLE IF NOT EXISTS movie_subtitles (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id bigint NOT NULL REFERENCES movie_sources(id) ON DELETE CASCADE,
    language text NOT NULL CHECK (language ~ '^[A-Za-z0-9-]{1,35}$'),
    label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 100),
    url text NOT NULL,
    is_default boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS movie_subtitles_source_idx ON movie_subtitles(source_id);
CREATE TABLE IF NOT EXISTS episode_watch_progress (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_slug text NOT NULL,
    episode_key text NOT NULL,
    position_seconds numeric NOT NULL CHECK (position_seconds >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, movie_slug, episode_key),
    FOREIGN KEY (movie_slug, episode_key) REFERENCES movie_episodes(movie_slug, episode_key) ON DELETE CASCADE
);
-- This is an explicitly labelled, licensed player test clip, not a movie source.
INSERT INTO movie_sources(movie_slug,label,media_type,url,sort_order,attribution)
SELECT 'big-buck-bunny-demo','Video mẫu MP4','mp4','/static/media-demo/demo.mp4',1,
       'Video thử nghiệm Big Buck Bunny © 2008 Blender Foundation — CC BY 3.0. Đoạn trích đã chuyển mã.'
WHERE NOT EXISTS (SELECT 1 FROM movie_sources WHERE movie_slug='big-buck-bunny-demo' AND url='/static/media-demo/demo.mp4');
INSERT INTO movie_sources(movie_slug,label,media_type,url,sort_order,attribution)
SELECT 'big-buck-bunny-demo','Video mẫu HLS','hls','/static/media-demo/demo.m3u8',2,
       'Video thử nghiệm Big Buck Bunny © 2008 Blender Foundation — CC BY 3.0. Đoạn trích đã chuyển mã.'
WHERE NOT EXISTS (SELECT 1 FROM movie_sources WHERE movie_slug='big-buck-bunny-demo' AND url='/static/media-demo/demo.m3u8');
COMMIT;

-- Run only against the intended playback database after verifying the video can be embedded.
INSERT INTO movie_sources (movie_slug, episode_key, label, media_type, url, sort_order, attribution)
SELECT 'vo-ngoai-tinh-voi-sep', NULL, 'YouTube', 'iframe',
       'https://www.youtube.com/embed/sfDK-Znq-sE', 1, 'Nguồn: YouTube'
WHERE NOT EXISTS (
    SELECT 1 FROM movie_sources
    WHERE movie_slug = 'vo-ngoai-tinh-voi-sep' AND episode_key IS NULL
      AND url = 'https://www.youtube.com/embed/sfDK-Znq-sE'
);

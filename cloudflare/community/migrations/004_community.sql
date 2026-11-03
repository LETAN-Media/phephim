BEGIN;
CREATE TABLE community_rooms (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{1,64}$'),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
 public_read boolean NOT NULL DEFAULT true,
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community_roles (
 user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('admin','moderator')),
 granted_at timestamptz NOT NULL DEFAULT now(),
 granted_by bigint REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE community_members (
 room_id bigint NOT NULL REFERENCES community_rooms(id) ON DELETE CASCADE,
 user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 muted_until timestamptz,
 joined_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(room_id,user_id)
);
CREATE TABLE community_messages (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 room_id bigint NOT NULL REFERENCES community_rooms(id) ON DELETE CASCADE,
 user_id bigint REFERENCES users(id) ON DELETE SET NULL,
 reply_to_id bigint REFERENCES community_messages(id) ON DELETE SET NULL,
 is_bot boolean NOT NULL DEFAULT false,
 body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
 client_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 deleted_at timestamptz,
 CHECK ((is_bot AND user_id IS NULL AND client_id IS NULL) OR (NOT is_bot AND client_id IS NOT NULL)),
 UNIQUE (user_id,client_id),
 UNIQUE (id,room_id)
);
CREATE INDEX community_messages_room_history_idx ON community_messages(room_id,id DESC) WHERE deleted_at IS NULL;
CREATE TABLE community_pins (
 room_id bigint NOT NULL REFERENCES community_rooms(id) ON DELETE CASCADE,
 message_id bigint PRIMARY KEY,
 FOREIGN KEY (message_id,room_id) REFERENCES community_messages(id,room_id) ON DELETE CASCADE,
 pinned_at timestamptz NOT NULL DEFAULT now(),
 pinned_by bigint REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX community_pins_room_idx ON community_pins(room_id,pinned_at DESC);
CREATE TABLE community_reports (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 message_id bigint NOT NULL REFERENCES community_messages(id) ON DELETE CASCADE,
 reporter_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 UNIQUE (message_id,reporter_id)
);
CREATE TABLE community_moderation_actions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_id bigint NOT NULL REFERENCES users(id),
 action text NOT NULL,
 room_id bigint REFERENCES community_rooms(id),
 target_user_id bigint REFERENCES users(id),
 message_id bigint REFERENCES community_messages(id),
 details jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bot_schedules (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 room_id bigint NOT NULL REFERENCES community_rooms(id) ON DELETE CASCADE,
 body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
 next_at timestamptz NOT NULL,
 interval_seconds integer CHECK (interval_seconds BETWEEN 3600 AND 31536000),
 pin boolean NOT NULL DEFAULT false,
 enabled boolean NOT NULL DEFAULT true,
 created_by bigint REFERENCES users(id),
 created_by_telegram_id bigint,
 CHECK (created_by IS NOT NULL OR created_by_telegram_id IS NOT NULL),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bot_announcements (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 room_id bigint NOT NULL REFERENCES community_rooms(id),
 message_id bigint NOT NULL UNIQUE REFERENCES community_messages(id),
 dedupe_key text NOT NULL UNIQUE,
 schedule_id bigint REFERENCES bot_schedules(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community_ai_requests (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 room_id bigint NOT NULL REFERENCES community_rooms(id) ON DELETE CASCADE,
 user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 message_id bigint NOT NULL UNIQUE REFERENCES community_messages(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed'))
);
CREATE INDEX community_ai_requests_limits_idx ON community_ai_requests(room_id,user_id,created_at DESC);
CREATE TABLE community_notification_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 event_type text NOT NULL CHECK (event_type IN ('episode.published','movie.published','movie.schedule_updated')),
 dedupe_key text NOT NULL UNIQUE,
 movie_slug text NOT NULL,
 episode_key text,
 release_at timestamptz,
 CHECK (event_type<>'episode.published' OR episode_key IS NOT NULL),
 CHECK (event_type<>'movie.schedule_updated' OR release_at IS NOT NULL),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','done','failed')),
 attempts integer NOT NULL DEFAULT 0,
 lease_until timestamptz,
 lease_token uuid,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 message_id bigint REFERENCES community_messages(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_notification_events_pending_idx ON community_notification_events(state,next_attempt_at,id);
CREATE TABLE community_movie_releases (
 movie_slug text PRIMARY KEY,
 release_at timestamptz NOT NULL,
 verification_note text NOT NULL CHECK (char_length(verification_note) BETWEEN 1 AND 500),
 verified_by bigint NOT NULL REFERENCES users(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community_catalog_snapshot (
 movie_slug text PRIMARY KEY,
 first_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community_catalog_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 initialized_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION community_record_episode_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO community_notification_events(event_type,dedupe_key,movie_slug,episode_key)
  VALUES ('episode.published','episode:' || NEW.movie_slug || ':' || NEW.episode_key, NEW.movie_slug,NEW.episode_key)
  ON CONFLICT(dedupe_key) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER community_episode_published AFTER INSERT ON movie_episodes
FOR EACH ROW EXECUTE FUNCTION community_record_episode_event();
CREATE TABLE community_welcome_state (
 user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 room_id bigint NOT NULL REFERENCES community_rooms(id) ON DELETE CASCADE,
 last_welcomed_at timestamptz NOT NULL,
 PRIMARY KEY(user_id,room_id)
);
CREATE TABLE telegram_updates (
 update_id bigint PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE telegram_admin_actions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 actor_telegram_id bigint NOT NULL,
 action text NOT NULL,
 target_id bigint,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE telegram_drafts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 author_telegram_id bigint NOT NULL,
 body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
 room_id bigint NOT NULL REFERENCES community_rooms(id),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
 announcement_message_id bigint REFERENCES community_messages(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE telegram_deliveries (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 message_id bigint NOT NULL REFERENCES community_messages(id),
 destination text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','unknown','failed')),
 telegram_message_id bigint,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(message_id,destination)
);
CREATE TABLE telegram_subscribers (
 telegram_user_id bigint PRIMARY KEY,
 subscribed_at timestamptz NOT NULL DEFAULT now(),
 active boolean NOT NULL DEFAULT true
);
CREATE TABLE telegram_ai_requests (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 telegram_user_id bigint NOT NULL,
 update_id bigint NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX telegram_ai_requests_limits_idx ON telegram_ai_requests(telegram_user_id,created_at DESC);
CREATE TABLE community_word_rules (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 phrase text NOT NULL UNIQUE CHECK (char_length(phrase) BETWEEN 2 AND 100),
 enabled boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_by bigint REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE community_warning_state (
 user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 warning_count integer NOT NULL DEFAULT 0 CHECK (warning_count BETWEEN 0 AND 3),
 cycle_started_at timestamptz NOT NULL DEFAULT now(),
 banned_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE community_violations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 room_id bigint NOT NULL REFERENCES community_rooms(id) ON DELETE CASCADE,
 client_id uuid NOT NULL,
 reply_to_id bigint REFERENCES community_messages(id) ON DELETE SET NULL,
 body text NOT NULL,
 reason text NOT NULL CHECK (reason IN ('url','language')),
 warning_number integer NOT NULL CHECK (warning_number BETWEEN 1 AND 3),
 banned_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 voided_at timestamptz,
 reviewed_by bigint REFERENCES users(id) ON DELETE SET NULL,
 appeal_status text NOT NULL DEFAULT 'none' CHECK (appeal_status IN ('none','pending','upheld','voided')),
 UNIQUE(user_id,client_id)
);
CREATE INDEX community_violations_user_idx ON community_violations(user_id,created_at DESC);
INSERT INTO community_word_rules(phrase,enabled) VALUES
 ('lồn',true),('kẹt',false),('đụ mẹ mày',true),('đụ má',true),('đéo mẹ',true),('đĩ mẹ',true),('cái lồn',true),('con kẹt',true);
INSERT INTO community_rooms(slug,name) VALUES ('cong-dong-chung','Cộng đồng chung');
COMMIT;

-- Apply with psql in a transaction. User-supplied names are never SQL identifiers.
BEGIN;
CREATE TABLE IF NOT EXISTS users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username text NOT NULL CHECK (char_length(username) BETWEEN 3 AND 32),
    email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 254),
    password_hash text NOT NULL,
    email_verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_normalized_idx ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_normalized_idx ON users (lower(email));
CREATE TABLE IF NOT EXISTS user_sessions (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    csrf_token_hash bytea NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions(user_id);
CREATE TABLE IF NOT EXISTS email_verification_tokens (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS email_verification_tokens_user_id_idx ON email_verification_tokens(user_id);
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash bytea NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens(user_id);
CREATE TABLE IF NOT EXISTS user_favorites (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_slug text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, movie_slug)
);
CREATE TABLE IF NOT EXISTS watch_history (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_slug text NOT NULL,
    watched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS watch_history_user_time_idx ON watch_history(user_id, watched_at DESC);
CREATE TABLE IF NOT EXISTS watch_progress (
    user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    movie_slug text NOT NULL,
    position_seconds numeric NOT NULL CHECK (position_seconds >= 0),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, movie_slug)
);
COMMIT;

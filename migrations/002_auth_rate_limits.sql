BEGIN;
CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket text PRIMARY KEY,
    attempts integer NOT NULL CHECK (attempts >= 0),
    expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_expires_idx ON auth_rate_limits(expires_at);
COMMIT;

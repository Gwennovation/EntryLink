-- Brute-force protection and session revocation.
ALTER TABLE users ADD COLUMN failed_login_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until timestamptz;
-- Embedded in every token; bumping it (password change/reset) invalidates all existing sessions.
ALTER TABLE users ADD COLUMN token_version integer NOT NULL DEFAULT 0;

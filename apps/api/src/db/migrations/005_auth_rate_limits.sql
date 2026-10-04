CREATE TABLE auth_rate_limits (
  action text NOT NULL,
  ip_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (action, ip_hash, window_start)
);

CREATE INDEX auth_rate_limits_window_start_idx ON auth_rate_limits (window_start);

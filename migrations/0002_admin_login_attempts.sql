CREATE TABLE admin_login_attempts (
  key TEXT PRIMARY KEY,
  window_started TIMESTAMPTZ NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  locked_until TIMESTAMPTZ
);

CREATE INDEX idx_admin_login_attempts_window
  ON admin_login_attempts (window_started);

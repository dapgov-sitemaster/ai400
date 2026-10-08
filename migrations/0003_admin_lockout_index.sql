CREATE INDEX idx_admin_login_attempts_locked_until
  ON admin_login_attempts (locked_until)
  WHERE locked_until IS NOT NULL;

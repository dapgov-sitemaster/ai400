ALTER TABLE applications
  ADD COLUMN enrollment_status TEXT NOT NULL DEFAULT 'not_enrolled'
  CHECK (enrollment_status IN ('not_enrolled', 'enrolled'));

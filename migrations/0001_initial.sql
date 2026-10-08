CREATE TABLE applications (
  owner UUID PRIMARY KEY,
  data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  reference TEXT UNIQUE,
  submitted TIMESTAMPTZ,
  updated TIMESTAMPTZ NOT NULL
);

CREATE TABLE uploads (
  id UUID PRIMARY KEY,
  owner UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind = 'endorsement'),
  name TEXT NOT NULL,
  storage_key UUID NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('application/pdf', 'image/jpeg', 'image/png')),
  UNIQUE (owner, kind)
);

CREATE INDEX idx_uploads_owner ON uploads (owner);

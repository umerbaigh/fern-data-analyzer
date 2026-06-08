-- Upgrade existing DBs to per-source storage (safe to re-run)

CREATE TABLE IF NOT EXISTS slack_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  participants TEXT[] NOT NULL DEFAULT '{}',
  thread_id TEXT,
  raw_text TEXT NOT NULL,
  redacted_text TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, external_id)
);

CREATE TABLE IF NOT EXISTS gmail_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  participants TEXT[] NOT NULL DEFAULT '{}',
  thread_id TEXT,
  raw_text TEXT NOT NULL,
  redacted_text TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, external_id)
);

CREATE TABLE IF NOT EXISTS transcript_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  external_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  participants TEXT[] NOT NULL DEFAULT '{}',
  thread_id TEXT,
  raw_text TEXT NOT NULL,
  redacted_text TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, external_id)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
    INSERT INTO slack_messages (id, external_id, tenant_id, occurred_at, participants, thread_id, raw_text, redacted_text, metadata, ingested_at)
    SELECT id, external_id, tenant_id, occurred_at, participants, thread_id, raw_text, redacted_text, metadata, ingested_at
    FROM messages WHERE source = 'slack'
    ON CONFLICT (tenant_id, external_id) DO NOTHING;

    INSERT INTO gmail_messages (id, external_id, tenant_id, occurred_at, participants, thread_id, raw_text, redacted_text, metadata, ingested_at)
    SELECT id, external_id, tenant_id, occurred_at, participants, thread_id, raw_text, redacted_text, metadata, ingested_at
    FROM messages WHERE source = 'gmail'
    ON CONFLICT (tenant_id, external_id) DO NOTHING;

    INSERT INTO transcript_messages (id, external_id, tenant_id, occurred_at, participants, thread_id, raw_text, redacted_text, metadata, ingested_at)
    SELECT id, external_id, tenant_id, occurred_at, participants, thread_id, raw_text, redacted_text, metadata, ingested_at
    FROM messages WHERE source = 'transcript'
    ON CONFLICT (tenant_id, external_id) DO NOTHING;

    DROP TABLE IF EXISTS messages CASCADE;
  END IF;
END $$;

ALTER TABLE topics ADD COLUMN IF NOT EXISTS source TEXT;
UPDATE topics SET source = 'slack' WHERE source IS NULL;

ALTER TABLE message_topics ADD COLUMN IF NOT EXISTS source TEXT;
UPDATE message_topics SET source = 'slack' WHERE source IS NULL;

ALTER TABLE issues ADD COLUMN IF NOT EXISTS source TEXT;
UPDATE issues SET source = 'slack' WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_slack_messages_tenant_occurred ON slack_messages (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_gmail_messages_tenant_occurred ON gmail_messages (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcript_messages_tenant_occurred ON transcript_messages (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_topics_tenant_source ON topics (tenant_id, source);
CREATE INDEX IF NOT EXISTS idx_issues_tenant_source_status ON issues (tenant_id, source, status);

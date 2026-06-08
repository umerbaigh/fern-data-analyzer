CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS poll_cursors (
  source TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  cursor JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source, tenant_id)
);

-- Slack messages (stored separately from other sources)
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
  ai_processed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_messages_tenant_occurred ON slack_messages (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_slack_messages_unprocessed
  ON slack_messages (tenant_id, occurred_at DESC) WHERE ai_processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_slack_messages_thread ON slack_messages (tenant_id, thread_id);

-- Gmail messages
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
  ai_processed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_gmail_messages_tenant_occurred ON gmail_messages (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_gmail_messages_unprocessed
  ON gmail_messages (tenant_id, occurred_at DESC) WHERE ai_processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gmail_messages_thread ON gmail_messages (tenant_id, thread_id);

-- Meeting transcript chunks
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
  ai_processed_at TIMESTAMPTZ,
  UNIQUE (tenant_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_transcript_messages_tenant_occurred ON transcript_messages (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcript_messages_unprocessed
  ON transcript_messages (tenant_id, occurred_at DESC) WHERE ai_processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transcript_messages_thread ON transcript_messages (tenant_id, thread_id);

CREATE TABLE IF NOT EXISTS topics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id TEXT NOT NULL,
  source TEXT NOT NULL,
  label TEXT NOT NULL,
  summary TEXT,
  keywords TEXT[] NOT NULL DEFAULT '{}',
  message_count INT NOT NULL DEFAULT 0,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_topics_tenant_source ON topics (tenant_id, source);

CREATE TABLE IF NOT EXISTS message_topics (
  message_id UUID NOT NULL,
  source TEXT NOT NULL,
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  confidence REAL NOT NULL,
  PRIMARY KEY (message_id, topic_id)
);

CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  owner_guess TEXT,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  confidence REAL NOT NULL DEFAULT 0,
  evidence_message_ids UUID[] NOT NULL DEFAULT '{}',
  blockers TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_issues_tenant_source_status ON issues (tenant_id, source, status);

CREATE TABLE IF NOT EXISTS recommendations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  evidence_message_ids UUID[] NOT NULL DEFAULT '{}',
  issue_id UUID REFERENCES issues(id) ON DELETE SET NULL,
  topic_id UUID REFERENCES topics(id) ON DELETE SET NULL,
  priority INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_recommendations_user ON recommendations (tenant_id, user_id, created_at DESC);

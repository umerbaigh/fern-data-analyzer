-- Track AI analysis completion independently of topic assignment.

ALTER TABLE slack_messages ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMPTZ;
ALTER TABLE gmail_messages ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMPTZ;
ALTER TABLE transcript_messages ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMPTZ;

-- Backfill: messages already linked to a topic were analyzed.
UPDATE slack_messages m
SET ai_processed_at = NOW()
WHERE ai_processed_at IS NULL
  AND EXISTS (
    SELECT 1 FROM message_topics mt
    WHERE mt.message_id = m.id AND mt.source = 'slack'
  );

UPDATE gmail_messages m
SET ai_processed_at = NOW()
WHERE ai_processed_at IS NULL
  AND EXISTS (
    SELECT 1 FROM message_topics mt
    WHERE mt.message_id = m.id AND mt.source = 'gmail'
  );

UPDATE transcript_messages m
SET ai_processed_at = NOW()
WHERE ai_processed_at IS NULL
  AND EXISTS (
    SELECT 1 FROM message_topics mt
    WHERE mt.message_id = m.id AND mt.source = 'transcript'
  );

CREATE INDEX IF NOT EXISTS idx_slack_messages_unprocessed
  ON slack_messages (tenant_id, occurred_at DESC) WHERE ai_processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gmail_messages_unprocessed
  ON gmail_messages (tenant_id, occurred_at DESC) WHERE ai_processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_transcript_messages_unprocessed
  ON transcript_messages (tenant_id, occurred_at DESC) WHERE ai_processed_at IS NULL;

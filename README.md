# Fern

Node.js + Express service that ingests **Slack**, **Gmail**, and **meeting transcripts**, stores them in Postgres, and uses **Google Gemini** to extract topics, open issues, and recommendations. PII is redacted before anything is sent to the AI.

## Prerequisites

- **Node.js** 20+
- **PostgreSQL** 15+
- **Redis** (BullMQ job queue)
- **Google AI API key** — [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- **Slack bot token** (optional) — for Slack ingestion
- **Gmail OAuth credentials** (optional) — for Gmail ingestion

## Quick start

```bash
cd fern
npm install
cp .env.example .env
# Edit .env with your credentials (see Configuration below)

# Start Postgres + Redis (Docker example)
docker run -d --name fern-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
docker run -d --name fern-redis -p 6379:6379 redis:7

# Create database (if needed)
createdb fern

npm run db:migrate
npm run dev
```

The API listens on `http://localhost:3000` (or `PORT` from `.env`).

### Production

```bash
npm run build
npm start
```

## Configuration

Copy `.env.example` to `.env` and fill in values:

| Variable | Description |
|----------|-------------|
| `PORT` | HTTP port (default `3000`) |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string |
| `ENABLE_BACKGROUND_JOBS` | `true` to enable 5-min polling + workers |
| `POLL_INTERVAL_MINUTES` | Poll interval (default `5`) |
| `SLACK_BOT_TOKEN` | Slack bot `xoxb-...` token |
| `SLACK_CHANNELS` | Comma-separated channel IDs to poll |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` | Google OAuth app credentials |
| `GMAIL_REFRESH_TOKEN` | From `npm run gmail:auth` |
| `GMAIL_USER_EMAIL` | Gmail account to read |
| `GMAIL_POLL_BACKFILL_LIMIT` | Max emails on first Gmail poll (default `20`) |
| `TRANSCRIPT_DIR` | Local folder for `.txt` / `.md` transcripts |
| `GOOGLE_AI_API_KEY` | Gemini API key |
| `GOOGLE_AI_MODEL` | Model ID (default `gemini-2.5-flash-lite`) |
| `GEMINI_MIN_DELAY_MS` | Min ms between Gemini calls (default `5000`) |
| `GEMINI_MAX_RETRIES` | Retries on rate limit (default `3`) |
| `AI_REPROCESS_PER_POLL` | Max AI analyses per source per poll (default `2`) |
| `AI_REPROCESS_ON_STARTUP` | Run AI backlog on boot (default `false`) |
| `REDACT_PII` | Redact emails/phones before storage & AI |
| `EXCLUDE_DM_CHANNELS` | Skip Slack DMs |

### Slack setup

1. Create a Slack app using [`docs/slack-app-manifest.json`](docs/slack-app-manifest.json).
2. Install the app to your workspace and copy the **Bot User OAuth Token**.
3. Invite the bot to the channels you want to read.
4. Set `SLACK_BOT_TOKEN` and `SLACK_CHANNELS` in `.env`.

Use `GET /api/sources/slack/channels` to find channel IDs.

### Gmail setup

1. Create a Google Cloud OAuth client (Desktop or Web).
2. Set `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` in `.env`.
3. Run the auth script:

```bash
npm run gmail:auth
```

4. Open the printed URL, approve access, paste the `code` from the redirect URL.
5. Copy the printed `refresh_token` into `GMAIL_REFRESH_TOKEN`.

### Meeting transcripts

Drop `.txt` or `.md` files into `TRANSCRIPT_DIR` (default `./data/transcripts`). They are chunked and ingested on the next poll.

## How it works

```
Cron (every 5 min) ──► BullMQ ──► Poll connectors (Slack / Gmail / Transcript)
                                      │
                                      ▼
                              Store messages (Postgres)
                                      │
                                      ▼
                              AI backlog (Gemini, rate-limited)
                              • Topic classification
                              • Issue extraction
```

- **Ingest** stores new messages without calling Gemini immediately.
- **AI backlog** processes unprocessed messages (no `ai_processed_at` timestamp), capped by `AI_REPROCESS_PER_POLL` per source per poll.
- On **`npm run dev` startup**, only new messages are ingested unless `AI_REPROCESS_ON_STARTUP=true`.
- Default tenant ID is `default`.

## API reference

Base URL: `http://localhost:3000`

### Health

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Service + database health |

```bash
curl http://localhost:3000/health
```

---

### Poll

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| `POST` | `/api/poll/:tenantId` | `sync=true` (optional) | Run a poll cycle. Without `sync`, enqueues a background job. With `sync=true`, runs immediately and returns results. |

```bash
# Background job
curl -X POST http://localhost:3000/api/poll/default

# Synchronous (ingest + AI backlog)
curl -X POST "http://localhost:3000/api/poll/default?sync=true"
```

---

### Live source preview (not from DB)

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| `GET` | `/api/sources/slack/status` | — | Slack connection status |
| `GET` | `/api/sources/slack/channels` | — | List channels the bot can see |
| `GET` | `/api/sources/slack/messages` | `channel`, `limit` | Live Slack messages |
| `GET` | `/api/sources/gmail/status` | — | Gmail connection status |
| `GET` | `/api/sources/gmail/messages` | `limit` | Live Gmail messages |

```bash
curl http://localhost:3000/api/sources/slack/status
curl http://localhost:3000/api/sources/slack/channels
curl "http://localhost:3000/api/sources/slack/messages?channel=C01234567&limit=10"
curl http://localhost:3000/api/sources/gmail/status
curl "http://localhost:3000/api/sources/gmail/messages?limit=10"
```

---

### Stored messages (from DB)

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| `GET` | `/api/messages/:tenantId/summary` | — | Message counts by source |
| `GET` | `/api/messages/:tenantId/slack` | `limit` | Stored Slack messages |
| `GET` | `/api/messages/:tenantId/gmail` | `limit` | Stored Gmail messages |
| `GET` | `/api/messages/:tenantId/transcripts` | `limit` | Stored transcript chunks |
| `GET` | `/api/messages/:tenantId/:source` | `limit` | Generic (`slack`, `gmail`, `transcript`) |

```bash
curl http://localhost:3000/api/messages/default/summary
curl "http://localhost:3000/api/messages/default/gmail?limit=20"
curl "http://localhost:3000/api/messages/default/slack?limit=20"
```

---

### Topics

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| `GET` | `/api/topics/:tenantId` | `source`, `limit` | List AI-extracted topics |

`source`: `slack` | `gmail` | `transcript` (optional)

```bash
curl http://localhost:3000/api/topics/default
curl "http://localhost:3000/api/topics/default?source=gmail&limit=20"
```

---

### Issues

| Method | Path | Query / Body | Description |
|--------|------|--------------|-------------|
| `GET` | `/api/issues/:tenantId` | `status`, `source` | List issues |
| `PATCH` | `/api/issues/:issueId` | JSON body | Update issue |

**`GET` query params**

- `status`: `open` | `in_progress` | `resolved` (optional)
- `source`: `slack` | `gmail` | `transcript` (optional)

**`PATCH` body**

```json
{
  "status": "in_progress",
  "ownerGuess": "alice@company.com"
}
```

```bash
curl http://localhost:3000/api/issues/default
curl "http://localhost:3000/api/issues/default?source=gmail&status=open"
curl -X PATCH http://localhost:3000/api/issues/<issue-id> \
  -H "Content-Type: application/json" \
  -d '{"status": "resolved"}'
```

---

### AI reprocess

| Method | Path | Query | Description |
|--------|------|-------|-------------|
| `POST` | `/api/process/:tenantId/reprocess` | `source`, `limit` | Manually run AI on unprocessed messages |

- `source`: `slack` | `gmail` | `transcript` (optional; default all)
- `limit`: capped at `AI_REPROCESS_PER_POLL`

```bash
curl -X POST "http://localhost:3000/api/process/default/reprocess?source=gmail"
curl -X POST "http://localhost:3000/api/process/default/reprocess?source=slack&limit=2"
```

---

### Recommendations

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/recommendations/:tenantId/:userId` | List recommendations for a user |
| `POST` | `/api/recommendations/:tenantId/:userId/generate` | Generate new recommendations (Gemini) |
| `POST` | `/api/recommendations/:id/dismiss` | Dismiss a recommendation |

```bash
curl http://localhost:3000/api/recommendations/default/alice
curl -X POST http://localhost:3000/api/recommendations/default/alice/generate
curl -X POST http://localhost:3000/api/recommendations/<rec-id>/dismiss
```

---

## NPM scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start dev server with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production server |
| `npm run db:migrate` | Apply SQL migrations + schema |
| `npm run gmail:auth` | One-time Gmail OAuth refresh token |

## Gemini rate limits

Free-tier defaults are tuned for `gemini-2.5-flash-lite`:

- `GEMINI_MIN_DELAY_MS=5000` → ~12 requests/minute
- `AI_REPROCESS_PER_POLL=2` → up to 6 AI calls per 5-min poll (2 × 3 sources)
- `AI_REPROCESS_ON_STARTUP=false` → no AI burst when restarting dev server

Use a current model (`gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-3.1-flash-lite`). Older Gemini 2.0 models have zero free-tier quota.

## Project structure

```
src/
  connectors/     Slack, Gmail, transcript ingestion
  pipeline/       Normalize + PII redaction
  services/       Poll, processor, analysis, LLM, topics, issues
  db/             Schema, migrations, repositories
  queue/          BullMQ workers
  scheduler/      Cron poller
  routes/         Express REST API
docs/
  slack-app-manifest.json
scripts/
  gmail-auth.ts
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| No topics/issues after poll | Check `GOOGLE_AI_API_KEY`, model name, and Gemini quota in logs |
| Gmail fetches 0 messages | First poll sets a baseline cursor; wait for next poll or check `GMAIL_REFRESH_TOKEN` |
| AI runs on every `npm run dev` | Set `AI_REPROCESS_ON_STARTUP=false` (default) |
| Messages re-analyzed | Run `npm run db:migrate` — requires `ai_processed_at` column |
| `503` on `/health` | Postgres is down or `DATABASE_URL` is wrong |
| Background jobs not running | Set `ENABLE_BACKGROUND_JOBS=true` and ensure Redis is up |

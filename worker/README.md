# Typing Zen ranking board (Cloudflare Worker)

One row per user who chose to share, Google or not: a masked name and words tested per day for the last 7 days.

- `src/index.js`: `GET /board?site=live|test`, `POST /board`, `DELETE /board/<id>?site=…` (header `X-Board-Key`).
- Storage: D1 (`schema.sql`), database `typing-zen-board`, location hint `oc` (Oceania). One table; `site` keeps the
  test build's rows (`site=test`) away from the live board.
- Ids: `g:<Google uid>` or `l:<install id>:<local id>`. Rows come back with `h` (16 hex of sha256(id)), never the id.
- Each row has a key; only its sha256 is stored. Without the key a row can't be changed or deleted.
- Kept: site, id, masked name, days, key hash, time of the last write. Not kept: IP address, user agent, referrer,
  cookies; nothing is logged. CORS: https://trix69.github.io only.
- Deploy: `worker/deploy.sh` (headless; Typing Zen's own token comes from `~/projects/typing-zen-cloudflare.env` and is
  never printed). The token needs Workers Scripts: Edit and **D1: Edit**. The first run creates the database and applies the schema.
- Tests: `tests/worker.js` (the Worker against an in-memory D1) and `tests/board.js` (the app against it).

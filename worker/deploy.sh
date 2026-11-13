#!/usr/bin/env bash
# Deploy the ranking board. Headless: wrangler with CLOUDFLARE_API_TOKEN read from ~/projects/cloudflare.env (never
# printed), the account id asked of the API when the file has none. Creates the D1 database the first time, puts its id
# into wrangler.toml (an id, not a secret) and applies schema.sql. Usage: worker/deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
CREDS="$HOME/projects/cloudflare.env"
read_env() { [ -f "$1" ] || return 1; sed -n "s/^[[:space:]]*$2[[:space:]]*=[[:space:]]*//p" "$1" | head -1 | tr -d '"' | tr -d "'" | tr -d '\r'; }
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then CLOUDFLARE_API_TOKEN=$(read_env "$CREDS" CLOUDFLARE_API_TOKEN || true); export CLOUDFLARE_API_TOKEN; fi
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || { echo "no CLOUDFLARE_API_TOKEN" >&2; exit 1; }
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then CLOUDFLARE_ACCOUNT_ID=$(read_env "$CREDS" CLOUDFLARE_ACCOUNT_ID || true); fi
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID=$(curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" https://api.cloudflare.com/client/v4/accounts | sed -n 's/.*"id":"\([a-f0-9]\{32\}\)".*/\1/p' | head -1)
fi
[ -n "$CLOUDFLARE_ACCOUNT_ID" ] || { echo "could not read an account id" >&2; exit 1; }
export CLOUDFLARE_ACCOUNT_ID
W="npx --yes wrangler@4"
if grep -q 'database_id = "DATABASE_ID"' wrangler.toml; then
  ID=$($W d1 list --json 2>/dev/null | python3 -c 'import json,sys; print(next((d["uuid"] for d in json.load(sys.stdin) if d["name"]=="typing-zen-board"), ""))' || true)
  if [ -z "$ID" ]; then $W d1 create typing-zen-board --location oc 2>&1 | tail -3; ID=$($W d1 list --json | python3 -c 'import json,sys; print(next(d["uuid"] for d in json.load(sys.stdin) if d["name"]=="typing-zen-board"))'); fi
  sed -i '' "s/database_id = \"DATABASE_ID\"/database_id = \"$ID\"/" wrangler.toml
  echo "D1 database typing-zen-board: $ID"
fi
$W d1 execute typing-zen-board --remote --file schema.sql 2>&1 | tail -2
$W deploy 2>&1 | tee /tmp/tz-board-deploy.log | tail -8

#!/usr/bin/env bash
#
# Clear the live-feed credibility cache and force a fresh AI run.
#
# The backend dedupes every fetched report against backend/data/livefeeds.db, so
# items seen in a previous run never hit the LLM again (you see no AI I/O in the
# console). This wipes that cache and re-polls so EVERY item is re-analysed.
#
#   - Backend running: POST /api/reset (clears the reports table + re-polls,
#     keeping the geocode cache so Nominatim is not hammered).
#   - Backend down:    delete the SQLite file for a cold start on next boot.
#
# Usage: npm run reset:feeds   (override the API with API_BASE=http://host:port)
set -euo pipefail

API="${API_BASE:-http://localhost:8000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB="$ROOT/backend/data/livefeeds.db"

if curl -fsS -X POST "$API/api/reset" >/dev/null 2>&1; then
  echo "Reset via $API/api/reset — feed cache cleared and re-polled."
  echo "Watch the backend console for the fresh [LLM REQUEST] / [LLM RAW RESPONSE] dump."
else
  echo "Backend not reachable at $API — deleting the SQLite cache for a cold start."
  rm -f "$DB" "$DB-wal" "$DB-shm"
  echo "Deleted backend/data/livefeeds.db* — restart the backend to reprocess every item."
fi

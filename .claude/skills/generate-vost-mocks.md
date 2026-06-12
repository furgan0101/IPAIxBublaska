---
name: generate-vost-mocks
description: Generates realistic mock OSINT data (tweets, telegram messages) for Konstanz to test the UI and filtering logic.
---
# Instructions
1. Generate 5 verified crisis reports (e.g., clustered within a 1km radius in Konstanz within the last hour).
2. Generate 3 disinformation reports (e.g., highly exaggerated, conflicting metadata, or outdated timestamps).
3. Disinformation reports must exhibit conflicting timestamps (stale EXIF, e.g. media captured >48 h before posting) or conflicting locations (EXIF geotag far from the claimed position) or bot-spam phrasing.
4. Output these directly into `backend/mock_data.json`, structured to match `RawReport` in `backend/schemas.py` (the backend ingestion schema). Run `npm run test:api` afterwards to confirm the file still validates.

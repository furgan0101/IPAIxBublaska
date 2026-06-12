"""Live OSINT ingestion: real open-data connectors for the VOSTbw dashboard.

Keyless public sources, polled on an interval by `service.IngestionService`:

  - NINA          official German civil-protection warnings (BBK api31)
  - Presseportal  police / fire press releases ("Blaulicht" RSS)
  - Mastodon      public hashtag timelines (social-media OSINT)

Everything is opt-in via FEEDS_ENABLED=true in backend/.env; without the flag
the backend serves the synthetic mock feed exactly as before, and pytest stays
fully offline (connectors are exercised against recorded fixtures only).
"""
from ingestion.config import IngestionSettings
from ingestion.service import IngestionService, default_connectors

__all__ = ["IngestionSettings", "IngestionService", "default_connectors"]

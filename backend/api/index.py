"""Vercel Python serverless entrypoint.

Vercel's Python runtime looks for a callable named `app` (ASGI) or `handler`
(WSGI) in api/index.py.  We re-export the FastAPI app from main.py directly.
"""
import sys
import os

# Make the backend root importable (main.py, schemas.py, logic/, ingestion/).
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from main import app  # noqa: E402 — path manipulation must come first

__all__ = ["app"]

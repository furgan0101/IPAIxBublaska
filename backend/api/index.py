"""Vercel Python serverless entrypoint.

Vercel runs this file with the backend root as the working directory, so
`main` is importable directly. The runtime looks for an ASGI callable
named `app`.
"""
from main import app  # noqa: F401

__all__ = ["app"]

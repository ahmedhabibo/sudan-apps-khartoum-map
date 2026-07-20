"""
Vercel serverless entry point for KhartoumMap backend.

Vercel auto-detects `api/index.py` and mounts it at the root URL.
This re-exports the FastAPI app from backend/main.py.

For local dev:  uvicorn backend.main:app --reload --port 8000
For Vercel:     npx vercel --prod  (this file is the handler)
"""

import sys
import os

# Make backend/ importable when deployed as a serverless function
_backend_dir = os.path.join(os.path.dirname(__file__), "..", "backend")
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from main import app  # noqa: E402

# Vercel expects an ASGI app named `app` at module level

"""Smoke test for the adapted FastAPI backend."""
import sys
import os

# Make backend importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

import main

print(f"App title: {main.app.title}")
print(f"App version: {main.app.version}")
print("Routes:")
for route in main.app.routes:
    if hasattr(route, "methods") and route.methods:
        method = list(route.methods)[0]
        print(f"  {method:6s} {route.path}")

# Verify DB seeded
import sqlite3
conn = sqlite3.connect(main.DB_PATH)
count = conn.execute("SELECT COUNT(*) FROM services").fetchone()[0]
conn.close()
print(f"\nServices in DB: {count}")
print(f"DB path: {main.DB_PATH}")

"""
FastAPI backend for KhartoumMap — offline-first service directory.

Endpoints:
  GET  /api/services?region=X&since=Y   — list services, optionally filtered
  GET  /api/services/{service_id}        — single service detail
  POST /api/updates                      — submit a status update
  GET  /api/updates?service_id=X         — list updates for a service
  GET  /api/health                        — health check
  POST /api/services/import              — bulk import services from JSON

Database: SQLite (schema.sql applied on first run)
Run: uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

import os
import sqlite3
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DB_PATH = os.environ.get("KHARTOUM_MAP_DB", str(Path(__file__).parent / "khartoum_map.db"))
SCHEMA_PATH = Path(__file__).parent / "schema.sql"
DATA_FILE = Path(__file__).parent.parent / "data" / "services_khartoum.json"

app = FastAPI(
    title="KhartoumMap API",
    description="Offline-first service directory backend for Khartoum metro area",
    version="1.0.0"
)

# CORS — allow PWA origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in production
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    with open(SCHEMA_PATH, "r") as f:
        conn.executescript(f.read())
    conn.commit()
    conn.close()

def seed_db_if_empty():
    """Import services from services_khartoum.json if DB is empty."""
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM services").fetchone()[0]
    if count == 0 and DATA_FILE.exists():
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        services = data.get("services", [])
        for svc in services:
            conn.execute(
                """INSERT OR REPLACE INTO services 
                   (id, name, type, type_ar, icon, lat, lng, region, neighborhood, 
                    neighborhood_en, status, report_count, last_reported, phone, hours, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (svc["id"], svc["name"], svc["type"], svc.get("type_ar", ""), 
                 svc.get("icon", ""), svc["lat"], svc["lng"], svc.get("region", ""),
                 svc.get("neighborhood", ""), svc.get("neighborhood_en", ""),
                 svc.get("status", "unknown"), svc.get("report_count", 0),
                 svc.get("last_reported", ""), svc.get("phone", ""), 
                 svc.get("hours", ""), svc.get("notes", ""))
            )
        conn.commit()
        print(f"Seeded {len(services)} services from {DATA_FILE.name}")
    conn.close()

# Initialize on import
init_db()
seed_db_if_empty()

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class ServiceUpdate(BaseModel):
    service_id: str = Field(..., description="Service ID (e.g., svc_001)")
    status: str = Field(..., pattern="^(open|closed|unknown)$")
    notes: str = Field("", description="Optional notes")
    timestamp: int = Field(..., description="Unix timestamp of the update")

class ServiceImport(BaseModel):
    services: List[dict]

class ServiceOut(BaseModel):
    id: str
    name: str
    type: str
    type_ar: str
    icon: str
    lat: float
    lng: float
    region: str
    neighborhood: str
    neighborhood_en: str
    status: str
    report_count: int
    last_reported: Optional[str]
    phone: str
    hours: str
    notes: str

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health():
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM services").fetchone()[0]
    conn.close()
    return {"status": "ok", "services": count, "db": DB_PATH}

@app.get("/api/services")
async def list_services(
    region: Optional[str] = Query(None, description="Filter by region (khartoum, omdurman, bahri)"),
    service_type: Optional[str] = Query(None, alias="type", description="Filter by type (bakery, pharmacy, etc.)"),
    since: Optional[str] = Query(None, description="ISO date — only services updated after this")
):
    """List services, optionally filtered by region, type, or update date."""
    conn = get_db()
    query = "SELECT * FROM services WHERE 1=1"
    params = []
    
    if region:
        query += " AND region = ?"
        params.append(region)
    
    if service_type:
        query += " AND type = ?"
        params.append(service_type)
    
    if since:
        query += " AND updated_at > ?"
        params.append(since)
    
    query += " ORDER BY neighborhood, name"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return {"services": [dict(r) for r in rows], "count": len(rows)}

@app.get("/api/services/{service_id}")
async def get_service(service_id: str):
    """Get a single service with its corroboration count from updates."""
    conn = get_db()
    svc = conn.execute("SELECT * FROM services WHERE id = ?", (service_id,)).fetchone()
    if not svc:
        conn.close()
        raise HTTPException(status_code=404, detail="Service not found")
    
    updates = conn.execute(
        "SELECT * FROM service_updates WHERE service_id = ? ORDER BY timestamp DESC",
        (service_id,)
    ).fetchall()
    conn.close()
    
    result = dict(svc)
    result["updates"] = [dict(u) for u in updates]
    return result

@app.post("/api/updates")
async def submit_update(update: ServiceUpdate):
    """Submit a status update for a service. Also updates the service's corroboration count."""
    conn = get_db()
    
    # Verify service exists
    svc = conn.execute("SELECT id, report_count FROM services WHERE id = ?", (update.service_id,)).fetchone()
    if not svc:
        conn.close()
        raise HTTPException(status_code=404, detail="Service not found")
    
    # Insert the update
    conn.execute(
        "INSERT INTO service_updates (service_id, status, notes, timestamp, synced_at) VALUES (?, ?, ?, ?, datetime('now'))",
        (update.service_id, update.status, update.notes, update.timestamp)
    )
    
    # Update service status and increment report count
    new_report_count = svc["report_count"] + 1
    conn.execute(
        """UPDATE services 
           SET status = ?, report_count = ?, last_reported = ?, updated_at = datetime('now')
           WHERE id = ?""",
        (update.status, new_report_count, datetime.now(timezone.utc).strftime("%Y-%m-%d"), update.service_id)
    )
    
    conn.commit()
    conn.close()
    
    return {
        "status": "accepted",
        "service_id": update.service_id,
        "new_status": update.status,
        "report_count": new_report_count
    }

@app.get("/api/updates")
async def list_updates(
    service_id: Optional[str] = Query(None, description="Filter by service ID"),
    limit: int = Query(50, le=500, description="Max results")
):
    """List status updates, optionally filtered by service."""
    conn = get_db()
    query = "SELECT * FROM service_updates"
    params = []
    
    if service_id:
        query += " WHERE service_id = ?"
        params.append(service_id)
    
    query += " ORDER BY timestamp DESC LIMIT ?"
    params.append(limit)
    
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return {"updates": [dict(r) for r in rows], "count": len(rows)}

@app.post("/api/services/import")
async def import_services(data: ServiceImport):
    """Bulk import/update services."""
    conn = get_db()
    count = 0
    for svc in data.services:
        conn.execute(
            """INSERT OR REPLACE INTO services 
               (id, name, type, type_ar, icon, lat, lng, region, neighborhood,
                neighborhood_en, status, report_count, last_reported, phone, hours, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (svc["id"], svc["name"], svc["type"], svc.get("type_ar", ""),
             svc.get("icon", ""), svc["lat"], svc["lng"], svc.get("region", ""),
             svc.get("neighborhood", ""), svc.get("neighborhood_en", ""),
             svc.get("status", "unknown"), svc.get("report_count", 0),
             svc.get("last_reported", ""), svc.get("phone", ""),
             svc.get("hours", ""), svc.get("notes", ""))
        )
        count += 1
    conn.commit()
    conn.close()
    return {"imported": count}

# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

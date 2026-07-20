# KhartoumMap — Offline Service Directory PWA

A Progressive Web App providing an offline-first service directory for the Khartoum metropolitan area (Khartoum, Omdurman, Bahri) with interactive maps.

## Architecture

Built on the shared Sudan Apps PWA scaffold (T1) with Leaflet.js for map rendering and Dexie.js for IndexedDB storage.

### Frontend (PWA)
- `index.html` — RTL app shell with sidebar navigation
- `app.js` — Main application logic (map, directory, sync)
- `db.js` — IndexedDB wrapper (services, service_updates, updates_queue stores)
- `sw.js` — Service Worker (Workbox 6.x, precaches Leaflet + Dexie + data)
- `styles.css` — RTL Flexbox layout, Arabic system fonts, map/badge styles
- `manifest.json` — PWA manifest (standalone display, Arabic)
- `data/services_khartoum.json` — 64 services across 8 types (bakery, pharmacy, clinic, fuel, market, water, bank, school)
- `data/gen_services.py` — Script that generated the seed data

### Backend (FastAPI)
- `backend/main.py` — FastAPI server with endpoints:
  - `GET /api/services?region=X&type=Y&since=Z` — list services
  - `GET /api/services/{id}` — single service with update history
  - `POST /api/updates` — submit status update (increments corroboration count)
  - `GET /api/updates?service_id=X` — list updates for a service
  - `POST /api/services/import` — bulk import services
  - `GET /api/health` — health check
- `backend/schema.sql` — SQLite schema (services + service_updates tables)
- `backend/requirements.txt` — Python dependencies

### APK (Bubblewrap)
- `bubblewrap-config.json` — Bubblewrap CLI config for TWA APK
- `twa-manifest.json` — Trusted Web Activity manifest

## Features

1. **Map View** — Leaflet.js map with color-coded pins (green=open, red=closed, gray=unknown), popup with status update buttons
2. **Service Directory** — Browse by type (8 categories) and region (3 areas), search by name
3. **Corroboration Badges** — Verified (3+ reports), Reported (1-2), Stale (0)
4. **Status Updates** — Mark services open/closed/unknown; updates saved to local IndexedDB
5. **Sync Queue** — Pending updates flush to backend automatically when online; manual sync button
6. **Offline First** — All data, Leaflet library, and OSM tiles precached; app works fully offline after first load

## Running

### Development (PWA only)
```bash
cd /Users/bashir/workspace/sudan-apps/khartoum-map
python3 -m http.server 8080
# Open http://localhost:8080
```

### Backend
```bash
cd /Users/bashir/workspace/sudan-apps/khartoum-map/backend
pip3 install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### APK (Bubblewrap)
```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://khartoummap.sudan-apps.org/manifest.json
bubblewrap build
# Output: app-release-signed.apk for sideloading
```

## Bundle Size
- App shell (HTML + CSS + JS): ~30KB
- services_khartoum.json: ~30KB
- Leaflet.js: ~39KB (precached from CDN)
- Total: ~100KB (well under 200KB target)

## Data Model

```json
{
  "id": "svc_001",
  "name": "مخبز النيل",
  "type": "bakery",
  "type_ar": "مخبز",
  "icon": "🍞",
  "lat": 15.6051,
  "lng": 32.5245,
  "region": "khartoum",
  "neighborhood": "الخرطوم",
  "status": "open",
  "report_count": 3,
  "last_reported": "2024-02-12"
}
```

## License
CC-BY-SA 4.0 (data), MIT (code)

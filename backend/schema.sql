/**
 * schema.sql — SQLite schema for KhartoumMap backend
 *
 * Tables: services, service_updates
 * - services: seed data synced from the PWA's services_khartoum.json
 * - service_updates: user-submitted status changes with corroboration counts
 */

CREATE TABLE IF NOT EXISTS services (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    type_ar     TEXT,
    icon        TEXT,
    lat         REAL NOT NULL,
    lng         REAL NOT NULL,
    region      TEXT,
    neighborhood TEXT,
    neighborhood_en TEXT,
    status      TEXT DEFAULT 'unknown' CHECK (status IN ('open', 'closed', 'unknown')),
    report_count INTEGER DEFAULT 0,
    last_reported TEXT,
    phone       TEXT DEFAULT '',
    hours       TEXT DEFAULT '',
    notes       TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS service_updates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    service_id  TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('open', 'closed', 'unknown')),
    notes       TEXT DEFAULT '',
    timestamp   INTEGER NOT NULL,
    synced_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (service_id) REFERENCES services(id)
);

-- Index for efficient region + since queries
CREATE INDEX IF NOT EXISTS idx_services_region ON services(region);
CREATE INDEX IF NOT EXISTS idx_services_type ON services(type);
CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_services_updated ON services(updated_at);

-- Index for corroboration lookups
CREATE INDEX IF NOT EXISTS idx_updates_service_id ON service_updates(service_id);
CREATE INDEX IF NOT EXISTS idx_updates_timestamp ON service_updates(timestamp);

-- View: services with latest corroboration counts
CREATE VIEW IF NOT EXISTS v_service_corroboration AS
SELECT 
    s.*,
    COUNT(su.id) AS total_reports,
    MAX(su.synced_at) AS last_synced_report
FROM services s
LEFT JOIN service_updates su ON su.service_id = s.id
GROUP BY s.id;

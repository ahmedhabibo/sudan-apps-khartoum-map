"""Smoke verification of the FastAPI backend without a network call."""
import json
import os
import sys

os.environ["KHARTOUM_MAP_DB"] = "/tmp/verify_khartoum_map.db"
if os.path.exists("/tmp/verify_khartoum_map.db"):
    os.unlink("/tmp/verify_khartoum_map.db")

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import main

print(f"App:      {main.app.title}  v{main.app.version}")
print("Routes:")
for r in main.app.routes:
    if hasattr(r, "methods") and r.methods:
        m = list(r.methods)[0]
        print(f"  {m:6s} {r.path}")

n = main.get_db().execute("SELECT COUNT(*) FROM services").fetchone()[0]
print(f"Services: {n}")

data = json.loads(open(main.DATA_FILE).read())
services = data.get("services", data) if isinstance(data, dict) else data
print(f"JSON services: {len(services)}")
types = {}
for s in services:
    t = s.get("type", "?")
    types[t] = types.get(t, 0) + 1
print(f"  types: {dict(sorted(types.items()))}")

# Sync test: pick a service, increment corroboration, verify it bumps.
svc_id = services[0]["id"]
before = main.get_db().execute("SELECT report_count FROM services WHERE id=?", (svc_id,)).fetchone()[0]
update = main.ServiceUpdate(service_id=svc_id, status="open", notes="local verify", timestamp=1700000000)
import asyncio
result = asyncio.run(main.submit_update(update))
after = main.get_db().execute("SELECT report_count FROM services WHERE id=?", (svc_id,)).fetchone()[0]
ok = (after == before + 1)
print(f"Sync test: report_count {before} -> {after}  ({'OK' if ok else 'FAIL'})  result={result}")

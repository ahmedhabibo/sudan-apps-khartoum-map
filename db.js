/**
 * db.js — IndexedDB wrapper using Dexie.js
 * Stores: content, updates_queue, progress, services, service_updates
 *
 * Adapted from shared scaffold for KhartoumMap.
 * Extended with services + service_updates stores for service directory.
 */

// Dexie is loaded via script tag in index.html (precached by SW)
function loadDexie() {
  return new Promise((resolve, reject) => {
    if (typeof Dexie !== "undefined") {
      resolve(Dexie);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/dexie@3.2.7/dist/dexie.min.js";
    script.onload = () => resolve(Dexie);
    script.onerror = () => reject(new Error("Failed to load Dexie from CDN"));
    document.head.appendChild(script);
  });
}

let _db = null;

async function initDB() {
  const DexieLib = await loadDexie();

  _db = new DexieLib("KhartoumMapDB");

  _db.version(1).stores({
    // content: general structured content (metadata, config)
    content: "&id, type, updatedAt",

    // updates_queue: pending sync items to flush to backend when online
    updates_queue: "++id, status, createdAt",

    // progress: user progress tracking
    progress: "&contentId, userId, type, updatedAt",

    // services: the service directory (bakeries, pharmacies, clinics, etc.)
    // keyPath = id, indexes on type, region, status for efficient filtering
    services: "&id, type, region, status, [type+status], [region+type], name, [region+status]",

    // service_updates: local status updates submitted by the user
    // keyPath = localId (auto-increment), index on serviceId + status + createdAt
    service_updates: "++localId, serviceId, status, createdAt, synced"
  });

  await _db.open();
  return _db;
}

const DB = {
  async ready() {
    if (!_db) await initDB();
    return _db;
  },

  // --- services store ---
  async putService(service) {
    const db = await this.ready();
    return db.services.put(service);
  },

  async putServices(servicesArray) {
    const db = await this.ready();
    return db.services.bulkPut(servicesArray);
  },

  async getService(id) {
    const db = await this.ready();
    return db.services.get(id);
  },

  async getAllServices() {
    const db = await this.ready();
    return db.services.toArray();
  },

  async getServicesByType(type) {
    const db = await this.ready();
    return db.services.where("type").equals(type).toArray();
  },

  async getServicesByRegion(region) {
    const db = await this.ready();
    return db.services.where("region").equals(region).toArray();
  },

  async updateServiceStatus(id, status) {
    const db = await this.ready();
    const service = await db.services.get(id);
    if (service) {
      service.status = status;
      service.report_count = (service.report_count || 0) + 1;
      service.last_reported = new Date().toISOString().split("T")[0];
      return db.services.put(service);
    }
  },

  // --- service_updates store (local status updates queue) ---
  async addServiceUpdate(serviceId, status, notes) {
    const db = await this.ready();
    const update = {
      serviceId: serviceId,
      status: status,
      notes: notes || "",
      createdAt: Date.now(),
      synced: 0
    };
    const localId = await db.service_updates.add(update);
    // Also update the service record locally
    await this.updateServiceStatus(serviceId, status);
    return localId;
  },

  async getPendingServiceUpdates() {
    const db = await this.ready();
    return db.service_updates.where("synced").equals(0).toArray();
  },

  async markServiceUpdateSynced(localId) {
    const db = await this.ready();
    return db.service_updates.update(localId, { synced: 1 });
  },

  async markServiceUpdateFailed(localId, error) {
    const db = await this.ready();
    return db.service_updates.update(localId, { synced: -1, error: String(error) });
  },

  // --- updates_queue store (general sync queue) ---
  async enqueueUpdate(updatePayload) {
    const db = await this.ready();
    return db.updates_queue.add({
      payload: updatePayload,
      status: "pending",
      createdAt: Date.now()
    });
  },

  async getPendingUpdates() {
    const db = await this.ready();
    return db.updates_queue.where("status").equals("pending").toArray();
  },

  async markUpdateDone(id) {
    const db = await this.ready();
    return db.updates_queue.update(id, { status: "done" });
  },

  async markUpdateFailed(id, error) {
    const db = await this.ready();
    return db.updates_queue.update(id, { status: "failed", error: String(error) });
  },

  // --- content store ---
  async putContent(item) {
    const db = await this.ready();
    item.updatedAt = item.updatedAt || Date.now();
    return db.content.put(item);
  },

  async getContent(id) {
    const db = await this.ready();
    return db.content.get(id);
  },

  // --- maintenance ---
  async getServiceCount() {
    const db = await this.ready();
    return db.services.count();
  },

  async clearServices() {
    const db = await this.ready();
    return db.services.clear();
  },

  async clearAll() {
    const db = await this.ready();
    await Promise.all([
      db.content.clear(),
      db.updates_queue.clear(),
      db.progress.clear(),
      db.services.clear(),
      db.service_updates.clear()
    ]);
  }
};

// Export as ES module
export default DB;

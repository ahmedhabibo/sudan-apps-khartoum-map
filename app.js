/**
 * app.js — KhartoumMap application logic
 *
 * Features:
 * - Map view with Leaflet.js, color-coded pins by service status
 * - Service directory: browse by type, search by name
 * - Corroboration badges: verified (3+ reports), reported (1-2), stale (0)
 * - Status update form: mark service open/closed → adds to service_updates queue
 * - Sync queue: flush pending updates to backend when online
 */

import DB from "./db.js";

// --- Constants ---
const KHARTOUM_CENTER = [15.6031, 32.5265];
const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = "&copy; OpenStreetMap contributors";
const STATUS_COLORS = {
  open: "#2e7d32",      // green
  closed: "#c62828",     // red
  unknown: "#757575"     // gray
};
const STATUS_LABELS = {
  open: "مفتوح",
  closed: "مغلق",
  unknown: "غير معروف"
};
const BACKEND_URL = "http://localhost:8000"; // configurable
const DATA_FILE = "data/services_khartoum.json";

// --- State ---
let map = null;
let markersLayer = null;
let allServices = [];
let currentFilter = { type: "all", search: "", region: "all" };
let currentView = "map";

// --- Init ---
async function init() {
  try {
    await DB.ready();
    const count = await DB.getServiceCount();
    if (count === 0) {
      await loadServicesIntoDB();
    }
    allServices = await DB.getAllServices();
    setupNavigation();
    setupSearchAndFilters();
    showView("map");
    updateStatusBar();
    // Listen for online/offline events
    window.addEventListener("online", flushSyncQueue);
    window.addEventListener("offline", () => updateStatusBar(true));
  } catch (err) {
    console.error("Init error:", err);
    document.getElementById("view-container").innerHTML =
      '<div class="error-message">خطأ في التحميل: ' + escapeHtml(err.message) + "</div>";
  }
}

// --- Load services JSON into IndexedDB ---
async function loadServicesIntoDB() {
  try {
    const resp = await fetch(DATA_FILE);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    if (data.services && data.services.length > 0) {
      await DB.putServices(data.services);
      // Store metadata
      await DB.putContent({ id: "services_meta", type: "metadata", ...data.metadata });
    }
  } catch (err) {
    console.error("Failed to load services data:", err);
    throw err;
  }
}

// --- Navigation ---
function setupNavigation() {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.addEventListener("click", () => {
      const view = item.dataset.view;
      showView(view);
      
      document.querySelectorAll(".nav-item").forEach((el) => {
        el.classList.remove("active");
      });
      
      item.classList.add("active");
    });
  });
}

function showView(view) {
  currentView = view;
  const container = document.getElementById("view-container");
  container.innerHTML = "";
  
  if (view === "map") renderMapView(container);
  else if (view === "directory") renderDirectoryView(container);
  else if (view === "sync") renderSyncView(container);
}

// --- MAP VIEW ---
function renderMapView(container) {
  container.innerHTML = `
    <div class="map-header">
      <h1>خريطة الخدمات</h1>
      <div class="map-stats" id="map-stats"></div>
    </div>
    <div id="map" class="map-container"></div>
    <div class="map-legend">
      <span class="legend-item"><span class="dot dot-open"></span> مفتوح</span>
      <span class="legend-item"><span class="dot dot-closed"></span> مغلق</span>
      <span class="legend-item"><span class="dot dot-unknown"></span> غير معروف</span>
    </div>
  `;

  // Initialize Leaflet map
  map = L.map("map", {
    center: KHARTOUM_CENTER,
    zoom: 13,
    zoomControl: true,
    attributionControl: true
  });

  L.tileLayer(TILE_URL, {
    attribution: TILE_ATTR,
    maxZoom: 19
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
  renderMarkers(getFilteredServices());
  updateMapStats();
}

function renderMarkers(services) {
  markersLayer.clearLayers();
  
  services.forEach((service) => {
    const color = STATUS_COLORS[service.status] || STATUS_COLORS.unknown;
    
    // Custom circle marker with color
    const marker = L.circleMarker([service.lat, service.lng], {
      radius: 8,
      fillColor: color,
      color: "#fff",
      weight: 2,
      opacity: 1,
      fillOpacity: 0.8
    });

    marker.bindPopup(`
      <div class="map-popup">
        <div class="popup-title">${service.icon} ${escapeHtml(service.name)}</div>
        <div class="popup-type">${escapeHtml(service.type_ar)}</div>
        <div class="popup-neighborhood">${escapeHtml(service.neighborhood)}</div>
        <div class="popup-status status-${service.status}">
          <span class="status-badge status-badge-${service.status}">${STATUS_LABELS[service.status]}</span>
        </div>
        ${renderCorroborationBadge(service)}
        <div class="popup-actions">
          <button class="btn-sm btn-open" onclick="window.khartoumMap.updateStatus('${service.id}', 'open')">تحديث: مفتوح</button>
          <button class="btn-sm btn-closed" onclick="window.khartoumMap.updateStatus('${service.id}', 'closed')">تحديث: مغلق</button>
          <button class="btn-sm btn-unknown" onclick="window.khartoumMap.updateStatus('${service.id}', 'unknown')">غير معروف</button>
        </div>
      </div>
    `);

    markersLayer.addLayer(marker);
  });

  // Fit bounds if we have markers
  if (services.length > 0) {
    const group = L.featureGroup(markersLayer.getLayers());
    if (group.getLayers().length > 0) {
      map.fitBounds(group.getBounds().pad(0.1));
    }
  }
}

function updateMapStats() {
  const filtered = getFilteredServices();
  const open = filtered.filter((s) => s.status === "open").length;
  const closed = filtered.filter((s) => s.status === "closed").length;
  const unknown = filtered.filter((s) => s.status === "unknown").length;
  
  document.getElementById("map-stats").innerHTML = `
    <span class="stat-badge">الإجمالي: ${filtered.length}</span>
    <span class="stat-badge stat-open">مفتوح: ${open}</span>
    <span class="stat-badge stat-closed">مغلق: ${closed}</span>
    <span class="stat-badge stat-unknown">غير معروف: ${unknown}</span>
  `;
}

// --- DIRECTORY VIEW ---
function renderDirectoryView(container) {
  container.innerHTML = `
    <div class="directory-header">
      <h1>دليل الخدمات</h1>
      <input type="search" id="search-input" class="search-input" placeholder="ابحث بالاسم…" value="${escapeHtml(currentFilter.search)}">
      <div class="filter-row">
        <select id="filter-type" class="filter-select">
          <option value="all">كل الأنواع</option>
          <option value="bakery">مخبز</option>
          <option value="pharmacy">صيدلية</option>
          <option value="clinic">مستشفى / عيادة</option>
          <option value="fuel">محطة وقود</option>
          <option value="market">سوق / بقالة</option>
          <option value="water">محطة مياه</option>
          <option value="bank">بنك / صراف آلي</option>
          <option value="school">مدرسة</option>
        </select>
        <select id="filter-region" class="filter-select">
          <option value="all">كل المناطق</option>
          <option value="khartoum">الخرطوم</option>
          <option value="omdurman">أم درمان</option>
          <option value="bahri">الخرطوم بحري</option>
        </select>
      </div>
    </div>
    <div id="service-list" class="service-list"></div>
  `;

  // Restore filter selections
  document.getElementById("filter-type").value = currentFilter.type;
  document.getElementById("filter-region").value = currentFilter.region;

  // Wire up search
  const searchInput = document.getElementById("search-input");
  searchInput.addEventListener("input", (e) => {
    currentFilter.search = e.target.value;
    renderServiceList();
  });

  // Wire up filters
  document.getElementById("filter-type").addEventListener("change", (e) => {
    currentFilter.type = e.target.value;
    renderServiceList();
    if (currentView === "map" && map) {
      renderMarkers(getFilteredServices());
      updateMapStats();
    }
  });

  document.getElementById("filter-region").addEventListener("change", (e) => {
    currentFilter.region = e.target.value;
    renderServiceList();
    if (currentView === "map" && map) {
      renderMarkers(getFilteredServices());
      updateMapStats();
    }
  });

  renderServiceList();
}

function renderServiceList() {
  const services = getFilteredServices();
  const listEl = document.getElementById("service-list");
  
  if (services.length === 0) {
    listEl.innerHTML = '<div class="no-results">لا توجد نتائج مطابقة</div>';
    return;
  }

  listEl.innerHTML = services.map((service) => `
    <div class="service-card" data-id="${service.id}">
      <div class="service-card-header">
        <span class="service-icon">${service.icon}</span>
        <span class="service-name">${escapeHtml(service.name)}</span>
        <span class="status-badge status-badge-${service.status}">${STATUS_LABELS[service.status]}</span>
      </div>
      <div class="service-card-body">
        <span class="service-type">${escapeHtml(service.type_ar)}</span>
        <span class="service-neighborhood">📍 ${escapeHtml(service.neighborhood)}</span>
        ${renderCorroborationBadge(service)}
      </div>
      <div class="service-card-actions">
        <button class="btn-sm btn-open" onclick="window.khartoumMap.updateStatus('${service.id}', 'open')">تحديث: مفتوح</button>
        <button class="btn-sm btn-closed" onclick="window.khartoumMap.updateStatus('${service.id}', 'closed')">تحديث: مغلق</button>
        <button class="btn-sm btn-unknown" onclick="window.khartoumMap.updateStatus('${service.id}', 'unknown')">غير معروف</button>
      </div>
    </div>
  `).join("");
}

// --- SYNC VIEW ---
async function renderSyncView(container) {
  const pending = await DB.getPendingServiceUpdates();
  const isOnline = navigator.onLine;
  
  container.innerHTML = `
    <div class="sync-header">
      <h1>المزامنة</h1>
      <div class="sync-status ${isOnline ? "online" : "offline"}">
        ${isOnline ? "متصل بالإنترنت" : "غير متصل (وضع عدم الاتصال)"}
      </div>
    </div>
    <div class="sync-actions">
      <button class="btn" onclick="window.khartoumMap.flushSync()" ${!isOnline ? "disabled" : ""}>
        مزامنة الآن (${pending.length} عنصر)
      </button>
    </div>
    <div id="sync-log" class="sync-log">
      ${pending.length === 0 ? "<p>لا توجد تحديثات معلقة</p>" : 
        pending.map((u) => `
          <div class="sync-item ${u.synced === -1 ? "sync-failed" : "sync-pending"}">
            <span>الخدمة: ${escapeHtml(u.serviceId)}</span>
            <span>الحالة: ${STATUS_LABELS[u.status] || u.status}</span>
            <span>التاريخ: ${new Date(u.createdAt).toLocaleString("ar")}</span>
            ${u.error ? '<span class="sync-error">خطأ: ' + escapeHtml(u.error) + "</span>" : ""}
          </div>
        `).join("")
      }
    </div>
  `;
}

// --- SYNC LOGIC ---
async function flushSync() {
  const pending = await DB.getPendingServiceUpdates();
  if (pending.length === 0) {
    alert("لا توجد تحديثات للمزامنة");
    return;
  }

  const logEl = document.getElementById("sync-log");
  let successCount = 0;
  let failCount = 0;

  for (const update of pending) {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/updates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_id: update.serviceId,
          status: update.status,
          notes: update.notes || "",
          timestamp: update.createdAt
        })
      });

      if (resp.ok) {
        await DB.markServiceUpdateSynced(update.localId);
        successCount++;
      } else {
        await DB.markServiceUpdateFailed(update.localId, `HTTP ${resp.status}`);
        failCount++;
      }
    } catch (err) {
      await DB.markServiceUpdateFailed(update.localId, err.message);
      failCount++;
    }
  }

  logEl.innerHTML = `
    <div class="sync-result">
      <p>تمت المزامنة: ${successCount} بنجاح، ${failCount} فشل</p>
    </div>
  `;

  updateStatusBar(!navigator.onLine);
}

// Auto-flush when online
async function flushSyncQueue() {
  if (navigator.onLine) {
    const pending = await DB.getPendingServiceUpdates();
    if (pending.length > 0) {
      console.log(`Online event: flushing ${pending.length} pending updates`);
      await flushSync();
    }
  }
  updateStatusBar(false);
}

// --- STATUS UPDATE ---
async function updateStatus(serviceId, newStatus) {
  try {
    await DB.addServiceUpdate(serviceId, newStatus, "");
    
    // Refresh local state
    allServices = await DB.getAllServices();
    
    // Re-render current view
    if (currentView === "directory") {
      renderServiceList();
    } else if (currentView === "map" && map) {
      renderMarkers(getFilteredServices());
      updateMapStats();
    }
    
    // Show confirmation
    const statusLabel = STATUS_LABELS[newStatus] || newStatus;
    
    // Check if online → auto-sync
    if (navigator.onLine) {
      await flushSync();
    } else {
      alert(`تم تحديث الحالة إلى: ${statusLabel}\n(سيتمت المزامنة عند توفر الاتصال)`);
    }
    
    updateStatusBar();
  } catch (err) {
    console.error("Update status error:", err);
    alert("خطأ في تحديث الحالة: " + err.message);
  }
}

// --- FILTERING ---
function getFilteredServices() {
  let result = allServices;
  
  if (currentFilter.type !== "all") {
    result = result.filter((s) => s.type === currentFilter.type);
  }
  
  if (currentFilter.region !== "all") {
    result = result.filter((s) => s.region === currentFilter.region);
  }
  
  if (currentFilter.search.trim()) {
    const q = currentFilter.search.trim().toLowerCase();
    result = result.filter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.neighborhood && s.neighborhood.toLowerCase().includes(q)) ||
      (s.type_ar && s.type_ar.toLowerCase().includes(q))
    );
  }
  
  return result;
}

// --- CORROBORATION BADGE ---
function renderCorroborationBadge(service) {
  const count = service.report_count || 0;
  let badgeClass, badgeText;
  
  if (count >= 3) {
    badgeClass = "corroboration-verified";
    badgeText = `مؤكّد (${count} تقارير)`;
  } else if (count >= 1) {
    badgeClass = "corroboration-reported";
    badgeText = `مبلّغ (${count} تقارير)`;
  } else {
    badgeClass = "corroboration-stale";
    badgeText = "قديم";
  }
  
  return `<span class="corroboration-badge ${badgeClass}">${badgeText}</span>`;
}

// --- STATUS BAR ---
async function updateStatusBar(offline) {
  const statusEl = document.getElementById("update-status");
  const pending = await DB.getPendingServiceUpdates();
  const isOnline = navigator.onLine && !offline;
  
  if (!isOnline) {
    statusEl.textContent = `غير متصل — ${pending.length} في الانتظار`;
    statusEl.className = "update-status offline";
  } else if (pending.length > 0) {
    statusEl.textContent = `${pending.length} تحديثات معلّقة`;
    statusEl.className = "update-status pending";
  } else {
    statusEl.textContent = "جاهز — متصل";
    statusEl.className = "update-status";
  }
}

// --- SEARCH & FILTER SETUP ---
function setupSearchAndFilters() {
  // This is called on init; the actual inputs are wired in renderDirectoryView
  // But we handle filter changes from the directory view here too
}

// --- UTILITIES ---
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text || "");
  return div.innerHTML;
}

// --- EXPORT FOR INLINE EVENT HANDLERS ---
window.khartoumMap = {
  updateStatus,
  flushSync
};

// --- START ---
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

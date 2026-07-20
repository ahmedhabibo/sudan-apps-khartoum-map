/**
 * Backend API URL configuration.
 * In production, update this to the deployed backend URL (Vercel).
 * In local dev, defaults to http://localhost:8000.
 *
 * For GitHub Pages deployment, the backend will be at a Vercel URL.
 * Update this file and redeploy to change the backend endpoint.
 */

// Auto-detect: if served from GitHub Pages, use the Vercel backend URL
const BACKEND_API_URL = (function() {
  const host = window.location.hostname;
  // Local development
  if (host === "localhost" || host === "127.0.0.1" || host === "") {
    return "http://localhost:8000";
  }
  // Production — Vercel backend URL will be set after deployment
  // Replace this with your actual Vercel URL, e.g.:
  // "https://khartoum-map-api.vercel.app"
  return "https://khartoum-map-api.vercel.app";
})();

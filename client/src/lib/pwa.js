/* PWA runtime helpers — service worker registration, install prompt,
 * online/offline status, and an offline order queue.
 * Pure browser logic, no React; consumed by a hook in usePwa.js. */

// ── Service worker registration ──────────────────────────────────────────────
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // Register after load so it never competes with first paint.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration failed:', err);
    });
  });
}

// ── Install prompt capture ───────────────────────────────────────────────────
// The browser fires `beforeinstallprompt`; we stash it so a custom button can
// trigger installation on demand.
let deferredInstallPrompt = null;
const installListeners = new Set();

export function initInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installListeners.forEach((fn) => fn(true));
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installListeners.forEach((fn) => fn(false));
  });
}

export function canInstall() {
  return !!deferredInstallPrompt;
}

export function onInstallAvailabilityChange(fn) {
  installListeners.add(fn);
  return () => installListeners.delete(fn);
}

export async function promptInstall() {
  if (!deferredInstallPrompt) return false;
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installListeners.forEach((fn) => fn(false));
  return outcome === 'accepted';
}

// ── Offline order queue ──────────────────────────────────────────────────────
// Orders placed while offline are stashed in localStorage and replayed when the
// connection returns. Keeps the cafe taking orders even when WiFi drops.
const QUEUE_KEY = 'semivra_offline_orders';

export function getQueuedOrders() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); }
  catch { return []; }
}

export function queueOrder(payload) {
  const queue = getQueuedOrders();
  queue.push({ id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, payload, queuedAt: Date.now() });
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  return queue.length;
}

function setQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/**
 * Replay every queued order through the provided sender.
 * `sender(payload)` must return a truthy value on success (it is awaited).
 * Successfully-sent orders are removed; failures stay in the queue for the
 * next flush. Returns { sent, remaining }.
 */
export async function flushQueue(sender) {
  let queue = getQueuedOrders();
  if (queue.length === 0) return { sent: 0, remaining: 0 };
  let sent = 0;
  const survivors = [];
  for (const entry of queue) {
    try {
      const ok = await sender(entry.payload);
      if (ok) { sent++; } else { survivors.push(entry); }
    } catch {
      survivors.push(entry);
    }
  }
  setQueue(survivors);
  return { sent, remaining: survivors.length };
}

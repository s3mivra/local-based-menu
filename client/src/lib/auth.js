// ── CLIENT AUTH (in-memory access token + silent refresh) ────────────────────
//
// The access token is held ONLY in module memory — never localStorage — so an XSS
// payload can't exfiltrate a long-lived credential. It's short-lived (15m). The
// long-lived refresh token lives in an httpOnly cookie the JS can't read; on page
// load (memory is empty) we call /api/auth/refresh to silently mint a new access
// token from that cookie. On a 401 mid-session we transparently refresh once and
// retry the original request.
//
// All requests use `credentials: 'include'` so the refresh cookie is sent.

let accessToken = null;

// One-time cleanup of legacy localStorage tokens from the pre-migration build.
// The access token now lives only in memory; these keys are never written anymore.
try {
  localStorage.removeItem('semivra_token');
  localStorage.removeItem('kasa_token');
} catch { /* SSR / private mode — ignore */ }

export const getToken = () => accessToken;
export const setToken = (t) => { accessToken = t || null; };
export const clearToken = () => { accessToken = null; };

export const decodeToken = (t = accessToken) => {
  if (!t) return null;
  try { return JSON.parse(atob(t.split('.')[1])); } catch { return null; }
};

// De-duplicate concurrent refreshes: many in-flight requests share one refresh call.
let refreshing = null;

// Returns the { token, user } payload on success, or null. Updates in-memory token.
export function refreshSession(API_URL) {
  if (!refreshing) {
    refreshing = fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { accessToken = d?.token || null; return d?.token ? d : null; })
      .catch(() => { accessToken = null; return null; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function logout(API_URL) {
  try { await fetch(`${API_URL}/api/auth/logout`, { method: 'POST', credentials: 'include' }); }
  catch { /* best-effort */ }
  finally { accessToken = null; }
}

// Drop-in replacement for the old per-page apiFetch. Attaches the in-memory token,
// auto-injects JSON content-type, and silently refreshes + retries once on 401.
// On a persistent 401 it returns the response so callers can run their logout flow.
export async function apiFetch(API_URL, endpoint, options = {}) {
  const build = () => {
    const headers = { ...(options.headers || {}) };
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    const clean = endpoint.replace(API_URL, '');
    return fetch(`${API_URL}${clean}`, { ...options, headers, credentials: 'include' });
  };

  let response = await build();
  if (response.status === 401) {
    const refreshed = await refreshSession(API_URL);
    if (refreshed) response = await build(); // retry once with the fresh token
  }
  return response;
}

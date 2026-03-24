const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
const TOKEN_STORAGE_KEY = "petroleum.auth.token";

let token = localStorage.getItem(TOKEN_STORAGE_KEY) || "";

function setToken(nextToken) {
  token = nextToken || "";
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

export function getToken() {
  return token;
}

export function getApiBase() {
  return API_BASE;
}

export function logout() {
  setToken("");
}

export function completeOAuthLogin(nextToken) {
  setToken(nextToken);
}

export async function loginWithPassword(email, password) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Login failed");
  }
  const data = await res.json();
  setToken(data.token);
  return data;
}

export function loginDefault() {
  return loginWithPassword("manager@demo.com", "demo123");
}

export async function getOAuthProviders() {
  const res = await fetch(`${API_BASE}/auth/oauth/providers`);
  if (!res.ok) throw new Error("Unable to load OAuth providers");
  return res.json();
}

export function oauthStartUrl(provider) {
  const redirectTo = `${window.location.origin}/auth/callback`;
  const url = new URL(`${API_BASE}/auth/oauth/${provider}/start`);
  url.searchParams.set("redirectTo", redirectTo);
  return url.toString();
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }
  return response.json();
}

export const api = {
  getSessionUser: () => request("/auth/me"),
  getCurrentJobber: () => request("/jobber"),
  updateCurrentJobber: (payload) =>
    request("/jobber", {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  getManagementOverview: () => request("/management/overview"),
  createManagedUser: (payload) =>
    request("/management/users", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateManagedUser: (userId, payload) =>
    request(`/management/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteManagedUser: (userId) =>
    request(`/management/users/${userId}`, {
      method: "DELETE"
    }),
  createManagedJobber: (payload) =>
    request("/management/jobbers", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getSites: () => request("/sites"),
  getSite: (siteId) => request(`/sites/${siteId}`),
  getPumps: (siteId) => request(`/sites/${siteId}/pumps`),
  createSite: (payload) =>
    request("/sites", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateSite: (siteId, payload) =>
    request(`/sites/${siteId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteSite: (siteId) =>
    request(`/sites/${siteId}`, {
      method: "DELETE"
    }),
  updateIntegrations: (siteId, payload) =>
    request(`/sites/${siteId}/integrations`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  addTank: (siteId, payload) =>
    request(`/sites/${siteId}/tanks`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateTank: (tankId, payload) =>
    request(`/tanks/${tankId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteTank: (tankId) =>
    request(`/tanks/${tankId}`, {
      method: "DELETE"
    }),
  addPump: (siteId, payload) =>
    request(`/sites/${siteId}/pumps`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updatePump: (pumpId, payload) =>
    request(`/pumps/${pumpId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deletePump: (pumpId) =>
    request(`/pumps/${pumpId}`, {
      method: "DELETE"
    }),
  getLayout: (siteId) => request(`/sites/${siteId}/layout`),
  saveLayout: (siteId, payload) =>
    request(`/sites/${siteId}/layout`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getAlerts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/alerts${query ? `?${query}` : ""}`);
  },
  getTankHistory: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/history/tanks${query ? `?${query}` : ""}`);
  },
  getTankInformation: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/tank-information${query ? `?${query}` : ""}`);
  },
  getPricingSnapshot: () => request("/market/pricing"),
  ackAlert: (id) => request(`/alerts/${id}/ack`, { method: "POST" })
};

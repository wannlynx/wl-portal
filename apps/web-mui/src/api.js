const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const TOKEN_STORAGE_KEY = "petroleum.mui.auth.token";
const LEGACY_TOKEN_STORAGE_KEY = "petroleum.auth.token";

let token = localStorage.getItem(TOKEN_STORAGE_KEY) || localStorage.getItem(LEGACY_TOKEN_STORAGE_KEY) || "";

if (token) {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
  localStorage.setItem(LEGACY_TOKEN_STORAGE_KEY, token);
}

function setToken(nextToken) {
  token = nextToken || "";
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    localStorage.setItem(LEGACY_TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
  }
}

function buildApiUrl(path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${normalizedPath}` : normalizedPath;
}

export function getApiBase() {
  return API_BASE;
}

export function getToken() {
  return token;
}

export function logout() {
  setToken("");
}

export function completeOAuthLogin(nextToken) {
  setToken(nextToken);
}

export function buildAuthenticatedApiUrl(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== "" && value != null) {
      query.set(key, String(value));
    }
  });
  const url = buildApiUrl(path);
  const queryText = query.toString();
  return queryText ? `${url}?${queryText}` : url;
}

export async function loginWithPassword(email, password) {
  const res = await fetch(buildApiUrl("/auth/login"), {
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

export async function getOAuthProviders() {
  const res = await fetch(buildApiUrl("/auth/oauth/providers"));
  if (!res.ok) throw new Error("Unable to load OAuth providers");
  return res.json();
}

export function oauthStartUrl(provider) {
  const redirectTo = `${window.location.origin}/auth/callback`;
  const url = new URL(buildApiUrl(`/auth/oauth/${provider}/start`), window.location.origin);
  url.searchParams.set("redirectTo", redirectTo);
  return url.toString();
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(buildApiUrl(path), { ...options, headers });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  return JSON.parse(text);
}

function normalizeCredentialStatus(payload) {
  const configured = Boolean(payload?.saved ?? payload?.configured);
  return {
    ...payload,
    saved: configured,
    configured
  };
}

export const api = {
  getApiHealth: () => request("/health"),
  getSessionUser: () => request("/auth/me"),
  getCurrentJobber: () => request("/jobber"),
  getAlerts: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/alerts${query ? `?${query}` : ""}`);
  },
  getJobberEiaCredentialsStatus: async () => normalizeCredentialStatus(await request("/jobber/eia-credentials")),
  saveJobberEiaCredentials: (payload) =>
    request("/jobber/eia-credentials", {
      method: "PUT",
      body: JSON.stringify(payload)
    }).then(normalizeCredentialStatus),
  getJobberOpisCredentialsStatus: async () => normalizeCredentialStatus(await request("/jobber/opis-credentials")),
  saveJobberOpisCredentials: (payload) =>
    request("/jobber/opis-credentials", {
      method: "PUT",
      body: JSON.stringify(payload)
    }).then(normalizeCredentialStatus),
  getJobberPricingConfigs: () => request("/jobber/pricing-configs"),
  saveJobberPricingConfig: (payload) =>
    request("/jobber/pricing-configs", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
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
  getCustomers: () => request("/customers"),
  createCustomer: (payload) =>
    request("/customers", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getCustomer: (customerId) => request(`/customers/${customerId}`),
  updateCustomer: (customerId, payload) =>
    request(`/customers/${customerId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteCustomer: (customerId) =>
    request(`/customers/${customerId}`, {
      method: "DELETE"
    }),
  getCustomerPricingProfile: (customerId) => request(`/customers/${customerId}/pricing-profile`),
  saveCustomerPricingProfile: (customerId, payload) =>
    request(`/customers/${customerId}/pricing-profile`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  getPricingRules: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/pricing/rules${query ? `?${query}` : ""}`);
  },
  createPricingRule: (payload) =>
    request("/pricing/rules", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getPricingRule: (ruleId) => request(`/pricing/rules/${ruleId}`),
  updatePricingRule: (ruleId, payload) =>
    request(`/pricing/rules/${ruleId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deletePricingRule: (ruleId) =>
    request(`/pricing/rules/${ruleId}`, {
      method: "DELETE"
    }),
  savePricingRuleComponents: (ruleId, components) =>
    request(`/pricing/rules/${ruleId}/components`, {
      method: "PUT",
      body: JSON.stringify({ components })
    }),
  savePricingRuleVendorSets: (ruleId, vendorSets) =>
    request(`/pricing/rules/${ruleId}/vendor-sets`, {
      method: "PUT",
      body: JSON.stringify({ vendorSets })
    }),
  getSites: () => request("/sites"),
  createSite: (payload) =>
    request("/sites", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  deleteSite: (siteId) =>
    request(`/sites/${siteId}`, {
      method: "DELETE"
    }),
  getSite: (siteId) => request(`/sites/${siteId}`),
  getPumps: (siteId) => request(`/sites/${siteId}/pumps`),
  addTank: (siteId, payload) =>
    request(`/sites/${siteId}/tanks`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  addPump: (siteId, payload) =>
    request(`/sites/${siteId}/pumps`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getTankHistory: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/history/tanks${query ? `?${query}` : ""}`);
  },
  getTankInformation: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/tank-information${query ? `?${query}` : ""}`);
  },
  getAlliedPortfolioSummary: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/allied-transactions/portfolio-summary${query ? `?${query}` : ""}`);
  },
  getAlliedTransactionsSummary: (siteId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/sites/${siteId}/allied-transactions/summary${query ? `?${query}` : ""}`);
  },
  getAlliedTransactions: (siteId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/sites/${siteId}/allied-transactions${query ? `?${query}` : ""}`);
  },
  getAlliedTransactionsExportUrl: (siteId, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return buildApiUrl(`/sites/${siteId}/allied-transactions/export${query ? `?${query}` : ""}`);
  },
  getAlliedUpgradeCards: () => request("/allied-upgrades/cards"),
  createAlliedUpgradeCard: (payload) =>
    request("/allied-upgrades/cards", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateAlliedUpgradeCard: (cardId, payload) =>
    request(`/allied-upgrades/cards/${cardId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteAlliedUpgradeCard: (cardId) =>
    request(`/allied-upgrades/cards/${cardId}`, {
      method: "DELETE"
    }),
  getAlliedUpgradeBatches: () => request("/allied-upgrades/batches"),
  createAlliedUpgradeBatch: (payload) =>
    request("/allied-upgrades/batches", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateAlliedUpgradeBatch: (batchId, payload) =>
    request(`/allied-upgrades/batches/${batchId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  getEbolOverview: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/ebols/overview${query ? `?${query}` : ""}`);
  },
  getEbolStatus: (bolNumber) => request(`/ebols/${encodeURIComponent(bolNumber)}/status`),
  getEbolExportUrl: (format, params = {}) => buildAuthenticatedApiUrl(`/ebols/export.${format}`, params),
  getPricingSnapshot: () => request("/market/pricing"),
  getOpisSnapshot: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/market/opis${query ? `?${query}` : ""}`);
  }
};

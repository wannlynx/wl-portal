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
  getJobberEiaCredentialsStatus: () => request("/jobber/eia-credentials"),
  saveJobberEiaCredentials: (payload) =>
    request("/jobber/eia-credentials", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  getJobberOpisCredentialsStatus: () => request("/jobber/opis-credentials"),
  saveJobberOpisCredentials: (payload) =>
    request("/jobber/opis-credentials", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
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
  createManagedJobber: (payload) =>
    request("/management/jobbers", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getSites: () => request("/sites"),
  getAlliedPortfolioSummary: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/allied-transactions/portfolio-summary${query ? `?${query}` : ""}`);
  },
  getSite: (siteId) => request(`/sites/${siteId}`),
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
    return `${API_BASE}/sites/${siteId}/allied-transactions/export${query ? `?${query}` : ""}`;
  },
  getSitePricingConfigs: (siteId) => request(`/sites/${siteId}/pricing-configs`),
  saveSitePricingConfig: (siteId, payload) =>
    request(`/sites/${siteId}/pricing-configs`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
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
  createCustomerContact: (customerId, payload) =>
    request(`/customers/${customerId}/contacts`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateCustomerContact: (customerId, contactId, payload) =>
    request(`/customers/${customerId}/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteCustomerContact: (customerId, contactId) =>
    request(`/customers/${customerId}/contacts/${contactId}`, {
      method: "DELETE"
    }),
  getCustomerPricingProfile: (customerId) => request(`/customers/${customerId}/pricing-profile`),
  saveCustomerPricingProfile: (customerId, payload) =>
    request(`/customers/${customerId}/pricing-profile`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  getPricingSources: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/pricing/sources${query ? `?${query}` : ""}`);
  },
  createPricingSource: (payload) =>
    request("/pricing/sources", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getPricingSource: (sourceId) => request(`/pricing/sources/${sourceId}`),
  addPricingSourceValues: (sourceId, values) =>
    request(`/pricing/sources/${sourceId}/values`, {
      method: "POST",
      body: JSON.stringify({ values })
    }),
  getPricingTaxes: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/pricing/taxes${query ? `?${query}` : ""}`);
  },
  savePricingTaxes: (schedules) =>
    request("/pricing/taxes", {
      method: "PUT",
      body: JSON.stringify({ schedules })
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
  previewPricingRun: (payload) =>
    request("/pricing/runs/preview", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  generatePricingRun: (payload) =>
    request("/pricing/runs", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getPricingRunHistory: (pricingDate, params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/pricing/runs/${pricingDate}${query ? `?${query}` : ""}`);
  },
  getGeneratedPricingOutputs: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/pricing/outputs${query ? `?${query}` : ""}`);
  },
  getGeneratedPricingOutput: (outputId) => request(`/pricing/outputs/${outputId}`),
  getOpisSnapshot: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/market/opis${query ? `?${query}` : ""}`);
  },
  getOpisRawSnapshot: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return request(`/market/opis/raw${query ? `?${query}` : ""}`);
  },
  ackAlert: (id) => request(`/alerts/${id}/ack`, { method: "POST" })
};

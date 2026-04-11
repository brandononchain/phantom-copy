const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || err.message || 'Request failed');
  }

  return res.json();
}

export const api = {
  // Auth
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (email, password, name) => request('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
  me: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  updateProfile: (data) => request('/api/auth/me', { method: 'PATCH', body: JSON.stringify(data) }),

  // Accounts
  getAccounts: () => request('/api/accounts'),
  connectAccount: (data) => request('/api/accounts', { method: 'POST', body: JSON.stringify(data) }),
  deleteAccount: (id) => request(`/api/accounts/${id}`, { method: 'DELETE' }),

  // Trades
  getTrades: (params) => request(`/api/trades?${new URLSearchParams(params)}`),
  getTradeStats: () => request('/api/trades/stats'),

  // Proxies
  getProxies: () => request('/api/proxies'),
  rotateProxy: (accountId) => request(`/api/proxies/${accountId}/rotate`, { method: 'POST' }),
  healthCheck: (accountId) => request(`/api/proxies/${accountId}/health`, { method: 'POST' }),

  // Billing
  getPlans: () => request('/api/billing/plans'),
  getBillingInfo: () => request('/api/billing/info'),
  changePlan: (plan) => request('/api/billing/change-plan', { method: 'POST', body: JSON.stringify({ plan }) }),
  createCheckout: (plan) => request('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan }) }),

  // Pro+ Proxy Pools
  getProxyPools: () => request('/api/proplus/proxy-pools'),
  createProxyPool: (data) => request('/api/proplus/proxy-pools', { method: 'POST', body: JSON.stringify(data) }),
  deleteProxyPool: (id) => request(`/api/proplus/proxy-pools/${id}`, { method: 'DELETE' }),
  rotatePool: (id) => request(`/api/proplus/proxy-pools/${id}/rotate`, { method: 'POST' }),

  // Pro+ API Keys
  getApiKeys: () => request('/api/proplus/keys'),
  createApiKey: (name, env) => request('/api/proplus/keys', { method: 'POST', body: JSON.stringify({ name, env }) }),
  revokeApiKey: (id) => request(`/api/proplus/keys/${id}`, { method: 'DELETE' }),

  // Pro+ Webhooks
  getWebhooks: () => request('/api/proplus/webhooks'),
  createWebhook: (url, events) => request('/api/proplus/webhooks', { method: 'POST', body: JSON.stringify({ url, events }) }),
  deleteWebhook: (id) => request(`/api/proplus/webhooks/${id}`, { method: 'DELETE' }),
  testWebhook: (id) => request(`/api/proplus/webhooks/${id}/test`, { method: 'POST' }),
  getDeliveries: (id) => request(`/api/proplus/webhooks/${id}/deliveries`),

  // Health
  health: () => request('/api/health'),
};

/**
 * Tenant-scoped API client for the AKARI CRM Cloudflare Pages Functions backend.
 * All requests remain same-origin so Cloudflare Access and CRM membership checks
 * apply automatically.
 */
const JSON_HEADERS = { 'content-type': 'application/json' };

async function request(path, options = {}) {
  const response = await fetch(`/api/${path.replace(/^\//, '')}`, {
    credentials: 'same-origin',
    ...options,
    headers: { ...JSON_HEADERS, ...(options.headers || {}) },
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const requestError = new Error(payload.error || `Request failed with status ${response.status}`);
    requestError.status = response.status;
    requestError.details = payload.details;
    throw requestError;
  }
  return payload;
}

function queryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export const AkariApi = {
  health: () => request('health'),
  me: () => request('me'),
  dashboard: () => request('dashboard'),
  projects: (params = {}) => request(`projects${queryString(params)}`),
  project: (id) => request(`projects/${encodeURIComponent(id)}`),
  contacts: (params = {}) => request(`contacts${queryString(params)}`),
  opportunities: () => request('opportunities'),
  tasks: (scope = 'mine') => request(`tasks${queryString({ scope })}`),
  campaigns: () => request('campaigns'),
  partners: () => request('partners'),
  payments: () => request('payments'),
  reports: () => request('reports'),
  createTask: (task) => request('tasks', { method: 'POST', body: JSON.stringify(task) }),
  updateTask: (id, patch) => request(`tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
};

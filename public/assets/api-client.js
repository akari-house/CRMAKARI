/**
 * Minimal API client for the AKARI CRM Cloudflare Pages Functions backend.
 * The current prototype renders demo data directly in HTML. These methods are
 * ready for the next step: replacing sample values with live D1 records.
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
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

export const AkariApi = {
  health: () => request('health'),
  me: () => request('me'),
  dashboard: () => request('dashboard'),
  projects: (query = '') => request(`projects?search=${encodeURIComponent(query)}`),
  opportunities: () => request('opportunities'),
  tasks: () => request('tasks'),
  campaigns: () => request('campaigns'),
  partners: () => request('partners'),
  createTask: (task) => request('tasks', { method: 'POST', body: JSON.stringify(task) }),
  updateTask: (id, patch) => request(`tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
};


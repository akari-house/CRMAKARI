export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

export function error(message, status = 400, details) {
  return json({ error: message, ...(details ? { details } : {}) }, status);
}

export async function readJson(request) {
  const type = request.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('Expected application/json');
  return request.json();
}


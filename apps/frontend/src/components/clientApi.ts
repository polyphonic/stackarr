export async function stackarrFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const apiKey = window.localStorage.getItem('stackarrApiKey');

  if (apiKey) {
    headers.set('X-Api-Key', apiKey);
  }

  const response = await fetch(input, { ...init, headers, credentials: init.credentials ?? 'same-origin' });

  if (response.status === 401) {
    const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (!window.location.pathname.startsWith('/login')) {
      window.location.assign(`/login?next=${encodeURIComponent(next)}`);
    }
  }

  return response;
}

export function storeStackarrApiKeyFromBody(body: unknown) {
  if (!body || typeof body !== 'object') {
    return;
  }

  const apiKey = (body as { apiKey?: unknown }).apiKey;

  if (typeof apiKey === 'string' && apiKey && !/^\*+$/.test(apiKey)) {
    window.localStorage.setItem('stackarrApiKey', apiKey);
  }
}

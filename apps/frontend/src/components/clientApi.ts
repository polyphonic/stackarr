export async function stackarrFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const apiKey = window.localStorage.getItem('stackarrApiKey');

  if (apiKey) {
    headers.set('X-Api-Key', apiKey);
  }

  let response = await fetch(input, { ...init, headers });

  if (response.status === 401) {
    const nextKey = window.prompt('Stackarr API key');

    if (nextKey) {
      window.localStorage.setItem('stackarrApiKey', nextKey);
      headers.set('X-Api-Key', nextKey);
      response = await fetch(input, { ...init, headers });
    }
  }

  return response;
}

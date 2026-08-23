import { requestJson, withQuery } from './http';
import { type ArrInstance, serviceApiKey, serviceBaseUrl } from './serviceConfig';

function ensureKey(instance: ArrInstance) {
  const apiKey = serviceApiKey(instance);
  if (!apiKey) throw new Error(`Missing API key for ${instance}. Save the service API key in Stackarr configuration.`);
  return apiKey;
}

export async function servarrGet<T = unknown>(
  instance: ArrInstance,
  path: string,
  query: Record<string, string | number | boolean | undefined> = {},
  apiVersion: 'v1' | 'v3' = 'v3'
) {
  const baseUrl = serviceBaseUrl(instance);
  const apiKey = ensureKey(instance);
  return requestJson<T>(
    withQuery(`${baseUrl}/api/${apiVersion}/${path.replace(/^\//, '')}`, { ...query, apikey: apiKey })
  );
}

export async function servarrPost<T = unknown>(
  instance: ArrInstance,
  path: string,
  body: unknown,
  apiVersion: 'v1' | 'v3' = 'v3',
  query: Record<string, string | number | boolean | undefined> = {}
) {
  const baseUrl = serviceBaseUrl(instance);
  const apiKey = ensureKey(instance);
  return requestJson<T>(
    withQuery(`${baseUrl}/api/${apiVersion}/${path.replace(/^\//, '')}`, { ...query, apikey: apiKey }),
    {
      method: 'POST',
      body
    }
  );
}

export async function servarrPut<T = unknown>(
  instance: ArrInstance,
  path: string,
  body: unknown,
  apiVersion: 'v1' | 'v3' = 'v3',
  query: Record<string, string | number | boolean | undefined> = {}
) {
  const baseUrl = serviceBaseUrl(instance);
  const apiKey = ensureKey(instance);
  return requestJson<T>(
    withQuery(`${baseUrl}/api/${apiVersion}/${path.replace(/^\//, '')}`, { ...query, apikey: apiKey }),
    {
      method: 'PUT',
      body
    }
  );
}

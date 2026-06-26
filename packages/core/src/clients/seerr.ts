import { requestJson, withQuery } from './http';
import { serviceApiKey, serviceBaseUrl } from './serviceConfig';

function headers() {
  const apiKey = serviceApiKey('seerr');
  if (!apiKey) throw new Error('Missing Seerr API key in Stackarr configuration.');
  return { 'X-Api-Key': apiKey };
}
export const seerrGet = <T = unknown>(
  path: string,
  query: Record<string, string | number | boolean | undefined> = {}
) =>
  requestJson<T>(withQuery(`${serviceBaseUrl('seerr')}/api/v1/${path.replace(/^\//, '')}`, query), {
    headers: headers()
  });
export const seerrPost = <T = unknown>(path: string, body: unknown) =>
  requestJson<T>(`${serviceBaseUrl('seerr')}/api/v1/${path.replace(/^\//, '')}`, {
    method: 'POST',
    headers: headers(),
    body
  });

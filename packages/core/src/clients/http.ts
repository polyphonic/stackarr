import { redactSecrets } from '../safety/redaction';

export type JsonRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
};

export class ServiceApiError extends Error {
  status?: number;
  details?: unknown;

  constructor(message: string, status?: number, details?: unknown) {
    super(message);
    this.name = 'ServiceApiError';
    this.status = status;
    this.details = redactSecrets(details);
  }
}

export async function requestJson<T = unknown>(url: string, options: JsonRequestOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        accept: 'application/json',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) {
          throw new ServiceApiError(`Invalid JSON from ${redactUrl(url)}`, response.status);
        }
        data = { message: text.slice(0, 500) };
      }
    }
    if (!response.ok) {
      throw new ServiceApiError(`HTTP ${response.status} from ${redactUrl(url)}`, response.status, data);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ServiceApiError) throw error;
    const message = controller.signal.aborted
      ? `Timed out after ${Math.round((options.timeoutMs ?? 10000) / 1000)} seconds`
      : error instanceof Error
        ? error.message
        : String(error);
    throw new ServiceApiError(`Request failed for ${redactUrl(url)}: ${message}`);
  } finally {
    clearTimeout(timeout);
  }
}

export function withQuery(baseUrl: string, params: Record<string, string | number | boolean | undefined>) {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function redactUrl(url: string) {
  return url.replace(/([?&](?:apikey|api_key|token|X-Plex-Token)=)[^&]+/gi, '$1********');
}

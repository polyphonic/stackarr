const secretKeyPattern =
  /(api[_-]?key|token|password|passwd|secret|credential|auth|plex[_-]?token|cookie|claim[_-]?code)/i;
const streamripSecretFieldKeys = new Set(['deezer.arl', 'qobuz.app_id', 'soundcloud.client_id']);
const tokenValuePattern = /([?&](?:apikey|api_key|token|X-Plex-Token)=)[^&\s]+/gi;
const urlPasswordPattern = /([a-z][a-z0-9+.-]*:\/\/[^:/\s]+:)[^@\s]+(@)/gi;
const assignedSecretPattern =
  /\b(api[_-]?key|token|password|passwd|secret|credential|authorization|cookie|claim[_-]?code)\s*[:=]\s*["']?[^\s,"'}]+/gi;
const bearerPattern = /\b(Bearer|Basic)\s+[a-z0-9._~+/=-]+/gi;
const authorizationValuePattern = /\bauthorization\s*[:=]\s*(?:Bearer|Basic)\s+[a-z0-9._~+/=-]+/gi;

export function isSensitiveKey(key: string): boolean {
  return streamripSecretFieldKeys.has(key.toLowerCase()) || secretKeyPattern.test(key);
}

export function redactString(value: string): string {
  return value
    .replace(tokenValuePattern, '$1********')
    .replace(urlPasswordPattern, '$1********$2')
    .replace(authorizationValuePattern, 'Authorization=********')
    .replace(assignedSecretPattern, '$1=********')
    .replace(bearerPattern, '$1 ********');
}

export function redactSecrets<T>(value: T): T {
  if (typeof value === 'string') {
    return redactString(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, isSensitiveKey(key) ? '********' : redactSecrets(nested)])
    ) as T;
  }

  return value;
}

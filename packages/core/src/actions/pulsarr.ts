import { requestJson } from '../clients/http';
import { serviceApiKey, serviceBaseUrl } from '../clients/serviceConfig';
import { redactSecrets } from '../safety/redaction';

const quotaTypes = ['daily', 'weekly_rolling', 'monthly'] as const;
export type PulsarrQuotaType = (typeof quotaTypes)[number];

export type PulsarrQuotaDefinition = {
  enabled: boolean;
  quotaType?: PulsarrQuotaType;
  quotaLimit?: number;
  bypassApproval?: boolean;
  watchlistCap?: number | null;
};

export type SetPulsarrUserQuotasInput = {
  userId: number;
  movieQuota?: PulsarrQuotaDefinition;
  showQuota?: PulsarrQuotaDefinition;
  autoApproveHeld?: boolean;
};

/**
 * Read users and quota records through Pulsarr's documented native API. The
 * quota response is intentionally returned separately because it is the
 * authoritative representation of configured quota records.
 */
export async function listPulsarrUsersAction() {
  const [users, quotas] = await Promise.all([
    pulsarrRequest('/users/users/list/with-counts'),
    pulsarrRequest<unknown>('/quota/users')
  ]);

  return redactSecrets({ users, quotas });
}

/** Read one user's profile, watchlist, quota configuration, and held-request count. */
export async function getPulsarrUserDiagnosticsAction(input: { userId: number }) {
  const userId = validUserId(input.userId);
  const [user, watchlist, quotas, heldRequests] = await Promise.all([
    pulsarrRequest(`/users/users/${userId}`),
    pulsarrRequest(`/users/${userId}/watchlist`),
    pulsarrRequest(`/quota/users/${userId}`),
    pulsarrRequest(`/quota/users/${userId}/pending-held-count`)
  ]);
  return redactSecrets({ userId, user, watchlist, quotas, heldRequests });
}

/** Explicit per-user sync opt-in/out; processing remains entirely Pulsarr-native. */
export async function setPulsarrUserSyncAction(input: { userId: number; canSync: boolean }) {
  const userId = validUserId(input.userId);
  if (typeof input.canSync !== 'boolean') throw new Error('canSync must be a boolean.');
  return redactSecrets(
    await pulsarrRequest(`/users/users/${userId}`, {
      method: 'PATCH',
      body: { can_sync: input.canSync }
    })
  );
}

/**
 * Create, update, or disable separate movie/show quotas through Pulsarr's
 * documented API. This changes quota policy only; it does not sync content or
 * auto-approve held requests unless autoApproveHeld is explicitly true.
 */
export async function setPulsarrUserQuotasAction(input: SetPulsarrUserQuotasInput) {
  const userId = validUserId(input.userId);
  const movieQuota = normalizeQuota(input.movieQuota, 'movieQuota');
  const showQuota = normalizeQuota(input.showQuota, 'showQuota');
  if (!movieQuota && !showQuota) throw new Error('Provide movieQuota, showQuota, or both.');

  const result = await pulsarrRequest<unknown>(`/quota/users/${userId}/separate`, {
    method: 'PATCH',
    body: {
      ...(movieQuota ? { movieQuota } : {}),
      ...(showQuota ? { showQuota } : {}),
      ...(input.autoApproveHeld === true ? { autoApproveHeld: true } : {})
    }
  });

  return redactSecrets({ userId, result });
}

async function pulsarrRequest<T>(path: string, options: { method?: 'GET' | 'PATCH'; body?: unknown } = {}) {
  const key = serviceApiKey('pulsarr');
  if (!key) {
    throw new Error(
      'Pulsarr requires an API key. Create a scoped local agent key in Pulsarr and save it as PULSARR_API_KEY in Stackarr.'
    );
  }

  return requestJson<T>(`${serviceBaseUrl('pulsarr')}/v1${path}`, {
    method: options.method ?? 'GET',
    headers: { 'X-Api-Key': key },
    body: options.body,
    timeoutMs: options.method === 'GET' ? 10_000 : 30_000
  });
}

function validUserId(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new Error('userId must be a positive integer.');
  }
  return value;
}

function normalizeQuota(value: PulsarrQuotaDefinition | undefined, name: string) {
  if (!value) return undefined;
  if (!value.enabled) return { enabled: false };

  if (!value.quotaType || !quotaTypes.includes(value.quotaType)) {
    throw new Error(`${name}.quotaType must be daily, weekly_rolling, or monthly when enabled.`);
  }
  const quotaLimit = value.quotaLimit;
  if (typeof quotaLimit !== 'number') {
    throw new Error(`${name}.quotaLimit must be an integer from 1 to 1000 when enabled.`);
  }
  if (!Number.isInteger(quotaLimit) || quotaLimit < 1 || quotaLimit > 1000) {
    throw new Error(`${name}.quotaLimit must be an integer from 1 to 1000 when enabled.`);
  }
  if (
    value.watchlistCap !== undefined &&
    value.watchlistCap !== null &&
    (!Number.isInteger(value.watchlistCap) || value.watchlistCap < 1 || value.watchlistCap > 1000)
  ) {
    throw new Error(`${name}.watchlistCap must be null or an integer from 1 to 1000.`);
  }

  return {
    enabled: true,
    quotaType: value.quotaType,
    quotaLimit: value.quotaLimit,
    ...(value.bypassApproval !== undefined ? { bypassApproval: value.bypassApproval } : {}),
    ...(value.watchlistCap !== undefined ? { watchlistCap: value.watchlistCap } : {})
  };
}

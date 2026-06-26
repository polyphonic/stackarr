export type ServiceFavorite = {
  name: string;
  displayName: string;
  localUrl?: string;
  browserUrl?: string;
};

export const serviceFavoritesChangedEvent = 'stackarr:service-favorites-changed';

let cachedFavorites: ServiceFavorite[] = [];

export function readServiceFavorites(): ServiceFavorite[] {
  return cachedFavorites;
}

export async function loadServiceFavorites(): Promise<ServiceFavorite[]> {
  const response = await fetch('/api/v1/services/favorites', { cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  const favorites = normalizeFavorites(body.favorites);

  setCachedFavorites(favorites);
  return favorites;
}

export async function writeServiceFavorites(names: string[]): Promise<ServiceFavorite[]> {
  const { stackarrFetch } = await import('./clientApi');
  const response = await stackarrFetch('/api/v1/services/favorites', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ names })
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || body.accepted === false) {
    throw new Error(body.error ?? body.message ?? 'Could not save favorite services.');
  }

  const favorites = normalizeFavorites(body.favorites);
  setCachedFavorites(favorites);
  return favorites;
}

export function subscribeServiceFavorites(onChange: (favorites: ServiceFavorite[]) => void) {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const localHandler = (event: Event) => {
    const favorites =
      event instanceof CustomEvent && Array.isArray(event.detail)
        ? normalizeFavorites(event.detail)
        : readServiceFavorites();
    onChange(favorites);
  };

  window.addEventListener(serviceFavoritesChangedEvent, localHandler);

  return () => {
    window.removeEventListener(serviceFavoritesChangedEvent, localHandler);
  };
}

function setCachedFavorites(favorites: ServiceFavorite[]) {
  cachedFavorites = favorites;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(serviceFavoritesChangedEvent, { detail: favorites }));
  }
}

function isServiceFavorite(value: unknown): value is ServiceFavorite {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const favorite = value as Partial<ServiceFavorite>;

  return (
    typeof favorite.name === 'string' &&
    typeof favorite.displayName === 'string' &&
    favorite.name.length > 0 &&
    favorite.displayName.length > 0 &&
    (favorite.localUrl === undefined || typeof favorite.localUrl === 'string') &&
    (favorite.browserUrl === undefined || typeof favorite.browserUrl === 'string')
  );
}

function normalizeFavorites(value: unknown): ServiceFavorite[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const favorites: ServiceFavorite[] = [];

  for (const item of value) {
    if (!isServiceFavorite(item) || seen.has(item.name)) {
      continue;
    }

    favorites.push(item);
    seen.add(item.name);
  }

  return favorites;
}

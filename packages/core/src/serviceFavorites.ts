import { getServices, type ServiceSummary } from './services';
import { readSettings, writeSettings } from './settings';

export type ServiceFavorite = {
  name: string;
  displayName: string;
  localUrl?: string;
  browserUrl?: string;
};

export function listServiceFavoritesAction(): ServiceFavorite[] {
  const services = getServices();
  const byName = new Map(services.map((service) => [service.name, service]));

  return favoriteNames()
    .map((name) => byName.get(name))
    .filter((service): service is ServiceSummary => Boolean(service))
    .filter((service) => service.mode !== 'disabled' && Boolean(service.localUrl || service.browserUrl))
    .map((service) => ({
      name: service.name,
      displayName: service.displayName,
      localUrl: service.localUrl,
      browserUrl: service.browserUrl
    }));
}

export function updateServiceFavoritesAction(input: { names: string[] }) {
  const validNames = new Set(
    getServices()
      .filter((service) => service.mode !== 'disabled' && Boolean(service.localUrl || service.browserUrl))
      .map((service) => service.name)
  );
  const nextNames = uniqueNames(input.names).filter((name) => validNames.has(name));

  writeSettings({
    ui: {
      serviceFavorites: nextNames
    }
  });

  return {
    accepted: true,
    favorites: listServiceFavoritesAction()
  };
}

function favoriteNames() {
  return uniqueNames(readSettings().ui.serviceFavorites);
}

function uniqueNames(names: unknown) {
  if (!Array.isArray(names)) {
    return [];
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const name of names) {
    if (typeof name !== 'string') {
      continue;
    }

    const normalized = name.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

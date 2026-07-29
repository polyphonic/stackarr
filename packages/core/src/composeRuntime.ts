const runtimeComposeServices = new Set([
  'database',
  'transmission',
  'qbittorrent',
  'prowlarr',
  'sonarr',
  'sonarr4k',
  'radarr',
  'radarr4k',
  'bazarr',
  'tinymediamanager',
  'pulsarr',
  'maintainerr',
  'cleanuparr',
  'agregarr',
  'tracearr',
  'redis',
  'seerr',
  'plex',
  'jellyfin',
  'recyclarr',
  'flaresolverr',
  'lidarr',
  'tidarr',
  'bookorbit',
  'romm',
  'questarr',
  'immich',
  'immich-ml'
]);

const lifecycleTargets: Record<string, string[]> = {
  ENABLE_MOVIES: ['radarr'],
  ENABLE_TV_SHOWS: ['sonarr'],
  ENABLE_4K_SERVARR: ['radarr4k', 'sonarr4k'],
  ENABLE_BAZARR: ['bazarr'],
  ENABLE_LIDARR: ['lidarr'],
  ENABLE_BOOKORBIT: ['bookorbit'],
  ENABLE_IMMICH: ['immich', 'immich-ml'],
  ENABLE_ROMM: ['romm'],
  ENABLE_QUESTARR: ['questarr'],
  ENABLE_TINYMEDIAMANAGER: ['tinymediamanager'],
  ENABLE_RECYCLARR: ['recyclarr'],
  ENABLE_FLARESOLVERR: ['flaresolverr'],
  ENABLE_TIDARR: ['tidarr'],
  ENABLE_SEERR: ['seerr'],
  ENABLE_PULSARR: ['pulsarr'],
  ENABLE_MAINTAINERR: ['maintainerr'],
  ENABLE_CLEANUPARR: ['cleanuparr'],
  ENABLE_AGREGARR: ['agregarr'],
  ENABLE_TRACEARR: ['tracearr'],
  PREFERRED_TORRENT_CLIENT: ['transmission', 'qbittorrent'],
  PLEX_INSTALL_MODE: ['plex'],
  JELLYFIN_INSTALL_MODE: ['jellyfin']
};

export function changedEnvironmentKeys(
  before: Record<string, string | undefined>,
  after: Record<string, string | undefined>
) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => (before[key] ?? '') !== (after[key] ?? '')
  );
}

export function composeServicesAffectedByEnvironment(composeSource: string, changedKeys: Iterable<string>) {
  const requestedKeys = new Set(changedKeys);
  const affected = new Set<string>();
  let inServices = false;
  let service = '';

  for (const line of composeSource.split(/\r?\n/)) {
    if (line === 'services:') {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^[^\s]/.test(line)) break;

    const serviceMatch = line.match(/^  ([a-zA-Z0-9][a-zA-Z0-9_-]*):\s*$/);
    if (serviceMatch) {
      service = serviceMatch[1];
      continue;
    }
    if (!service || !runtimeComposeServices.has(service)) continue;

    for (const match of line.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)) {
      if (requestedKeys.has(match[1])) affected.add(service);
    }
  }

  for (const key of requestedKeys) {
    for (const target of lifecycleTargets[key] ?? []) affected.add(target);
  }

  return [...affected].sort();
}

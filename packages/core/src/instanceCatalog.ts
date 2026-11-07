import catalog from './instance-catalog.json' with { type: 'json' };

/** Explicit reconciliation of service registry and Compose identities; aliases are import-only. */
export const instanceCatalog = catalog;
export type AppDefinition = { id: string; displayName: string };
export function listAppDefinitionsAction(): AppDefinition[] {
  return catalog.entries
    .filter((entry) => entry.kind === 'definition')
    .map((entry) => ({
      id: entry.definitionId!,
      displayName: entry.displayName ?? entry.sourceId
    }));
}
export function isCanonicalDefinition(id: string): boolean {
  return catalog.entries.some((entry) => entry.sourceId === id && entry.kind === 'definition');
}
export const downloadClientSources = ['sonarr', 'radarr', 'lidarr'] as const;
export const downloadClientTargets = ['qbittorrent', 'transmission'] as const;
export function isOptionalDownloadClientPair(source: string, target: string): boolean {
  return downloadClientSources.some((id) => id === source) && downloadClientTargets.some((id) => id === target);
}

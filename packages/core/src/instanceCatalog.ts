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

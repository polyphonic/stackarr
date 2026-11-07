import { randomUUID } from 'node:crypto';
import {
  connectInstanceRows,
  disconnectInstanceRows,
  InstanceConnectionConflict,
  type InstanceConnectionRow,
  type InstanceDbRow,
  type InstanceOwnership,
  insertInstanceRow,
  listInstanceConnectionRows,
  readConnectionInstanceDefinitions,
  readInstanceRowsPage,
  removeInstanceRow,
  renameInstanceRow
} from './database';
import { isCanonicalDefinition, isOptionalDownloadClientPair } from './instanceCatalog';

export type DraftInstance = {
  schemaVersion: 1;
  id: string;
  definitionId: string;
  displayName: string;
  ownership: InstanceOwnership;
  state: 'draft';
  createdAt: string;
  updatedAt: string;
};
export type DraftInstanceConnection = { schemaVersion: 1; sourceId: string; targetId: string; kind: 'download-client' };
export class InstanceActionError extends Error {
  constructor(
    public readonly code: 'invalid_input' | 'not_found' | 'conflict' | 'store_unavailable',
    message: string
  ) {
    super(message);
  }
}
export function safeInstanceAction<T>(action: () => T): T {
  try {
    return action();
  } catch (error) {
    if (error instanceof InstanceActionError) throw error;
    if (error instanceof InstanceConnectionConflict)
      throw new InstanceActionError('conflict', 'Disconnect instance connections before removal.');
    throw new InstanceActionError('store_unavailable', 'Instance store unavailable.');
  }
}
function invalid(message: string): never {
  throw new InstanceActionError('invalid_input', message);
}
function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!record(value) || Object.keys(value).some((key) => !keys.includes(key))) invalid('Unexpected or missing fields.');
  return value;
}
function idValue(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
    invalid('Invalid instance ID.');
  return value;
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 128 || /[\x00-\x1f\x7f-\x9f]/u.test(value))
    invalid('displayName must be 1-128 non-whitespace characters without controls.');
  return value.trim();
}
function dto(row: InstanceDbRow): DraftInstance {
  // Corrupt private JSON must fail closed; neither field belongs on the public DTO.
  for (const field of [row.configuration, row.secret_references]) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(field);
    } catch {
      throw new Error('Stored instance metadata is invalid.');
    }
    if (!record(parsed)) throw new Error('Stored instance metadata is invalid.');
  }
  if (row.state !== 'draft') throw new Error('Stored instance state is invalid.');
  return {
    schemaVersion: 1,
    id: row.id,
    definitionId: row.definition_id,
    displayName: row.display_name,
    ownership: row.ownership,
    state: 'draft',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
function connectionInput(value: unknown): InstanceConnectionRow {
  const input = exact(value, ['sourceId', 'targetId', 'kind']);
  if (!Object.hasOwn(input, 'sourceId') || !Object.hasOwn(input, 'targetId') || !Object.hasOwn(input, 'kind'))
    invalid('Unexpected or missing fields.');
  const source_id = idValue(input.sourceId);
  const target_id = idValue(input.targetId);
  if (source_id === target_id || input.kind !== 'download-client') invalid('Unsupported instance connection.');
  return { source_id, target_id, kind: 'download-client' };
}
function connectionDto(row: InstanceConnectionRow): DraftInstanceConnection {
  return { schemaVersion: 1, sourceId: row.source_id, targetId: row.target_id, kind: row.kind };
}
export function listDraftInstanceConnectionsAction(value: unknown): {
  schemaVersion: 1;
  items: DraftInstanceConnection[];
  nextCursor: string | null;
} {
  const input = exact(value, ['instanceId', 'limit', 'cursor']);
  if (!Object.hasOwn(input, 'instanceId')) invalid('Unexpected or missing fields.');
  const id = idValue(input.instanceId);
  const limit = input.limit === undefined ? 100 : input.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100)
    invalid('limit must be between 1 and 100.');
  let cursor: [string, string] | undefined;
  if (input.cursor !== undefined) {
    if (typeof input.cursor !== 'string' || input.cursor.split(':').length !== 2) invalid('Invalid connection cursor.');
    const [source, target] = input.cursor.split(':');
    cursor = [idValue(source), idValue(target)];
  }
  const rows = safeInstanceAction(() => readConnectionInstanceDefinitions(id, id));
  if (!rows.some((row) => row.id === id)) throw new InstanceActionError('not_found', 'Draft instance not found.');
  const page = safeInstanceAction(() => listInstanceConnectionRows(id, limit + 1, cursor));
  return {
    schemaVersion: 1,
    items: page.slice(0, limit).map(connectionDto),
    nextCursor: page.length > limit ? `${page[limit - 1].source_id}:${page[limit - 1].target_id}` : null
  };
}
export function connectDraftInstancesAction(value: unknown): DraftInstanceConnection {
  const row = connectionInput(value);
  const parents = safeInstanceAction(() => readConnectionInstanceDefinitions(row.source_id, row.target_id));
  if (!parents.some((p) => p.id === row.source_id) || !parents.some((p) => p.id === row.target_id))
    throw new InstanceActionError('not_found', 'Draft instance not found.');
  if (
    !isOptionalDownloadClientPair(
      parents.find((p) => p.id === row.source_id)!.definition_id,
      parents.find((p) => p.id === row.target_id)!.definition_id
    )
  )
    invalid('Unsupported instance connection.');
  if (!safeInstanceAction(() => connectInstanceRows(row)))
    throw new InstanceActionError('not_found', 'Draft instance not found.');
  return connectionDto(row);
}
export function disconnectDraftInstancesAction(value: unknown): DraftInstanceConnection {
  const row = connectionInput(value);
  if (!safeInstanceAction(() => disconnectInstanceRows(row)))
    throw new InstanceActionError('not_found', 'Draft connection not found.');
  return connectionDto(row);
}
export function listDraftInstancesAction(input: { limit?: number; cursor?: string } = {}) {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid('limit must be between 1 and 100.');
  const cursor = input.cursor === undefined ? undefined : idValue(input.cursor);
  const page = safeInstanceAction(() => readInstanceRowsPage(limit + 1, cursor));
  return {
    schemaVersion: 1 as const,
    items: safeInstanceAction(() => page.slice(0, limit).map(dto)),
    nextCursor: page.length > limit ? page[limit - 1].id : null
  };
}
export function createDraftInstanceAction(value: unknown): DraftInstance {
  const input = exact(value, ['definitionId', 'displayName', 'ownership']);
  if (typeof input.definitionId !== 'string' || !isCanonicalDefinition(input.definitionId))
    invalid('Unknown or noncanonical app definition.');
  const displayName = name(input.displayName);
  if (input.ownership !== 'managed' && input.ownership !== 'external' && input.ownership !== 'native')
    invalid('Invalid ownership.');
  return safeInstanceAction(() =>
    dto(
      insertInstanceRow({
        id: randomUUID(),
        definition_id: input.definitionId as string,
        display_name: displayName,
        ownership: input.ownership as InstanceOwnership,
        state: 'draft',
        configuration: '{}',
        secret_references: '{}'
      })
    )
  );
}
export function renameDraftInstanceAction(id: unknown, value: unknown): DraftInstance {
  const input = exact(value, ['displayName']);
  const validId = idValue(id);
  const displayName = name(input.displayName);
  const renamed = safeInstanceAction(() => renameInstanceRow(validId, displayName));
  if (!renamed) throw new InstanceActionError('not_found', 'Draft instance not found.');
  return safeInstanceAction(() => dto(renamed));
}
export function removeDraftInstanceAction(id: unknown): { id: string } {
  const validId = idValue(id);
  if (!safeInstanceAction(() => removeInstanceRow(validId)))
    throw new InstanceActionError('not_found', 'Draft instance not found.');
  return { id: validId };
}

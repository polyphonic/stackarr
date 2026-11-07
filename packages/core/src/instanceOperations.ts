import { getAgentActivityRecord } from './actions/agentActivity';
import { listAppDefinitionsAction } from './instanceCatalog';
import {
  createDraftInstanceAction,
  type DraftInstance,
  InstanceActionError,
  listDraftInstancesAction,
  removeDraftInstanceAction,
  renameDraftInstanceAction
} from './instances';
import type { ToolCatalogEntry } from './mcp/types';
import { auditFinished, auditStarted } from './safety/audit';

export type InstanceOperationName = 'catalog' | 'list' | 'create' | 'rename' | 'remove';
export type InstanceMutation = 'create' | 'rename' | 'remove';
export const instanceOperations: ReadonlyArray<{
  operation: InstanceOperationName;
  cli: string;
  mcp: string;
  http: { method: string; path: string };
  risk: ToolCatalogEntry['risk'];
  scopes: ToolCatalogEntry['scopes'];
  dtoVersion: 1;
}> = [
  {
    operation: 'catalog',
    cli: 'catalog',
    mcp: 'stackarr_list_app_definitions',
    http: { method: 'GET', path: '/api/v1/app-definitions' },
    risk: 'read',
    scopes: ['services:read'],
    dtoVersion: 1
  },
  {
    operation: 'list',
    cli: 'list',
    mcp: 'stackarr_list_instance_drafts',
    http: { method: 'GET', path: '/api/v1/instances' },
    risk: 'read',
    scopes: ['services:read'],
    dtoVersion: 1
  },
  {
    operation: 'create',
    cli: 'create',
    mcp: 'stackarr_create_instance_draft',
    http: { method: 'POST', path: '/api/v1/instances' },
    risk: 'write',
    scopes: ['services:write'],
    dtoVersion: 1
  },
  {
    operation: 'rename',
    cli: 'rename',
    mcp: 'stackarr_rename_instance_draft',
    http: { method: 'PATCH', path: '/api/v1/instances/{id}' },
    risk: 'write',
    scopes: ['services:write'],
    dtoVersion: 1
  },
  {
    operation: 'remove',
    cli: 'remove',
    mcp: 'stackarr_remove_instance_draft',
    http: { method: 'DELETE', path: '/api/v1/instances/{id}' },
    risk: 'dangerous',
    scopes: ['services:dangerous'],
    dtoVersion: 1
  }
];
const invalid = (): never => {
  throw new InstanceActionError('invalid_input', 'Unexpected or missing fields.');
};
function exact(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    return invalid();
  return input as Record<string, unknown>;
}
export function validateInstanceRenameBody(input: unknown) {
  const body = exact(input, ['displayName']);
  if (!Object.hasOwn(body, 'displayName')) invalid();
  return body;
}
export function executeInstanceOperation(
  operation: 'catalog',
  input?: unknown
): { schemaVersion: 1; items: ReturnType<typeof listAppDefinitionsAction> };
export function executeInstanceOperation(
  operation: 'list',
  input?: unknown
): ReturnType<typeof listDraftInstancesAction>;
export function executeInstanceOperation(operation: 'create' | 'rename', input: unknown): DraftInstance;
export function executeInstanceOperation(operation: 'remove', input: unknown): { id: string };
export function executeInstanceOperation(
  operation: InstanceOperationName,
  input?: unknown
):
  | { schemaVersion: 1; items: ReturnType<typeof listAppDefinitionsAction> }
  | ReturnType<typeof listDraftInstancesAction>
  | DraftInstance
  | { id: string };
export function executeInstanceOperation(operation: InstanceOperationName, input: unknown = {}) {
  switch (operation) {
    case 'catalog':
      exact(input, []);
      return { schemaVersion: 1 as const, items: listAppDefinitionsAction() };
    case 'list': {
      const fields = exact(input, ['limit', 'cursor']);
      return listDraftInstancesAction(fields as { limit?: number; cursor?: string });
    }
    case 'create':
      return createDraftInstanceAction(exact(input, ['definitionId', 'displayName', 'ownership']));
    case 'rename': {
      const fields = exact(input, ['id', 'displayName']);
      validateInstanceRenameBody({ displayName: fields.displayName });
      return renameDraftInstanceAction(fields.id, { displayName: fields.displayName });
    }
    case 'remove':
      return removeDraftInstanceAction(exact(input, ['id']).id);
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function instanceAuditEvidence(
  operation: InstanceOperationName,
  id: unknown,
  outcome: 'started' | 'success' | 'error' | 'denied'
) {
  return { action: operation, targetId: typeof id === 'string' && uuid.test(id) ? id : null, outcome };
}
export type InstanceAudit = { id: string; status: 'recorded' | 'degraded' };
export async function executeAuditedInstanceMutation(
  operation: InstanceMutation,
  input: unknown,
  caller: 'dashboard' | 'mcp-local' | `mcp-local:${string}` | `mcp-remote:${string}` = 'dashboard'
): Promise<(DraftInstance & { audit: InstanceAudit }) | { id: string; audit: InstanceAudit }> {
  const entry = instanceOperations.find((item) => item.operation === operation)!;
  const targetId = input && typeof input === 'object' && 'id' in input ? input.id : null;
  const started = Date.now();
  let activity: Awaited<ReturnType<typeof auditStarted>>;
  try {
    activity = await auditStarted({
      caller,
      toolName: entry.mcp,
      category: 'services',
      scopes: entry.scopes,
      risk: entry.risk,
      inputSummary: instanceAuditEvidence(operation, targetId, 'started')
    });
    const readback = await getAgentActivityRecord(activity.id);
    const evidence = instanceAuditEvidence(operation, targetId, 'started');
    if (
      !readback ||
      readback.id !== activity.id ||
      readback.status !== 'started' ||
      readback.toolName !== entry.mcp ||
      (readback.inputSummary as { action?: string; targetId?: string | null; outcome?: string } | undefined)?.action !==
        evidence.action ||
      (readback.inputSummary as { targetId?: string | null } | undefined)?.targetId !== evidence.targetId ||
      (readback.inputSummary as { outcome?: string } | undefined)?.outcome !== 'started'
    )
      throw new Error('Audit start not persisted.');
  } catch {
    throw new InstanceActionError('store_unavailable', 'Instance store unavailable.');
  }
  let result: DraftInstance | { id: string };
  try {
    result =
      operation === 'create'
        ? executeInstanceOperation('create', input)
        : operation === 'rename'
          ? executeInstanceOperation('rename', input)
          : executeInstanceOperation('remove', input);
  } catch (error) {
    try {
      await auditFinished(activity.id, {
        status: 'error',
        durationMs: Date.now() - started,
        resultSummary: instanceAuditEvidence(operation, targetId, 'error'),
        error: error instanceof InstanceActionError ? error.message : 'Instance store unavailable.'
      });
    } catch {
      /* preserve operation failure */
    }
    if (error instanceof InstanceActionError) throw error;
    throw new InstanceActionError('store_unavailable', 'Instance store unavailable.');
  }
  let status: InstanceAudit['status'] = 'degraded';
  try {
    await auditFinished(activity.id, {
      status: 'success',
      durationMs: Date.now() - started,
      resultSummary: instanceAuditEvidence(operation, result.id, 'success')
    });
    const readback = await getAgentActivityRecord(activity.id);
    if (
      readback?.id === activity.id &&
      readback.status === 'success' &&
      readback.toolName === entry.mcp &&
      (readback.resultSummary as { action?: string; targetId?: string; outcome?: string } | undefined)?.action ===
        operation &&
      (readback.resultSummary as { targetId?: string }).targetId === result.id &&
      (readback.resultSummary as { outcome?: string }).outcome === 'success'
    )
      status = 'recorded';
  } catch {
    /* committed mutation must not appear failed */
  }
  return { ...result, audit: { id: activity.id, status } };
}
export const executeAuditedHttpInstanceMutation = (operation: InstanceMutation, input: unknown) =>
  executeAuditedInstanceMutation(operation, input, 'dashboard');

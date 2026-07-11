import {
  administerNativeAppAction,
  auditFinished,
  auditStarted,
  getNativeAppCapabilitiesAction,
  manageNativeAppAction,
  type NativeAppName,
  type NativeAppOperationInput,
  nativeAppNames,
  readNativeAppAction,
  redactSecrets
} from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

const kinds = ['read', 'manage', 'dangerous'] as const;
type OperationKind = (typeof kinds)[number];

export function GET(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) return auth;
  return json(getNativeAppCapabilitiesAction());
}

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) return auth;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ message: 'A JSON request body is required.' }, { status: 400 });

  const source = body as Record<string, unknown>;
  const app = source.app;
  const kind = source.kind;
  const operation = source.operation;
  if (typeof app !== 'string' || !nativeAppNames.includes(app as NativeAppName)) {
    return json({ message: 'Choose a supported native app.' }, { status: 400 });
  }
  if (typeof kind !== 'string' || !kinds.includes(kind as OperationKind)) {
    return json({ message: 'Choose a valid operation type.' }, { status: 400 });
  }
  if (typeof operation !== 'string' || !operation.trim() || operation.length > 80) {
    return json({ message: 'Choose a valid operation.' }, { status: 400 });
  }

  const operationKind = kind as OperationKind;
  if (operationKind === 'dangerous' && source.confirmationText !== app) {
    return json({ message: `Type ${app} to confirm this file-changing action.` }, { status: 409 });
  }

  const input: NativeAppOperationInput = {
    app: app as NativeAppName,
    operation,
    ...optionalString(source, 'libraryId'),
    ...optionalString(source, 'itemId'),
    ...optionalString(source, 'taskId'),
    ...optionalString(source, 'sessionId'),
    ...optionalNumber(source, 'limit'),
    ...optionalNumber(source, 'days'),
    ...(source.scope === 'all' || source.scope === 'radarr' || source.scope === 'sonarr' ? { scope: source.scope } : {})
  };
  const risk = operationKind === 'read' ? 'read' : operationKind === 'manage' ? 'write' : 'dangerous';
  const scope = operationKind === 'read' ? 'apps:read' : operationKind === 'manage' ? 'apps:write' : 'apps:dangerous';
  const startedAt = Date.now();
  const activity = await auditStarted({
    caller: 'dashboard',
    toolName: `stackarr_${operationKind}_app`,
    category: 'apps',
    scopes: [scope],
    risk,
    inputSummary: { app, operation, kind: operationKind }
  });

  try {
    const result =
      operationKind === 'read'
        ? await readNativeAppAction(input)
        : operationKind === 'manage'
          ? await manageNativeAppAction(input)
          : await administerNativeAppAction({
              ...input,
              confirmDangerous: true,
              reason: typeof source.reason === 'string' ? source.reason : ''
            });
    await auditFinished(activity.id, {
      status: 'success',
      durationMs: Date.now() - startedAt,
      resultSummary: { app, operation, completed: true }
    });
    return json(result);
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : 'The native app operation failed.');
    await auditFinished(activity.id, {
      status: 'error',
      durationMs: Date.now() - startedAt,
      error: message
    });
    return json({ message }, { status: operationKind === 'dangerous' ? 409 : 400 });
  }
}

function optionalString(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === 'string' && value.length > 0 ? { [key]: value } : {};
}

function optionalNumber(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === 'number' ? { [key]: value } : {};
}

import {
  type AgregarrMediaScope,
  type AgregarrPreset,
  agregarrPresetNames,
  auditFinished,
  auditStarted,
  ensureAgregarrCollectionPresetAction,
  getAgregarrManagerAction,
  redactSecrets,
  syncAgregarrCollectionGroupAction,
  updateAgregarrCollectionGroupAction
} from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

const mediaScopes = ['movie', 'tv', 'both'] as const;
const actions = ['ensure-preset', 'update-group', 'sync-group'] as const;

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) return auth;

  try {
    return json(await getAgregarrManagerAction());
  } catch (error) {
    return json({ message: safeMessage(error) }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) return auth;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ message: 'A JSON request body is required.' }, { status: 400 });
  const source = body as Record<string, unknown>;
  const action = source.action;
  if (typeof action !== 'string' || !actions.includes(action as (typeof actions)[number])) {
    return json({ message: 'Choose a supported Agregarr action.' }, { status: 400 });
  }

  const startedAt = Date.now();
  const activity = await auditStarted({
    caller: 'dashboard',
    toolName: `stackarr_agregarr_${action.replaceAll('-', '_')}`,
    category: 'apps',
    scopes: ['apps:write'],
    risk: 'write',
    inputSummary: { action, preset: source.preset, mediaScope: source.mediaScope }
  });

  try {
    const result =
      action === 'ensure-preset'
        ? await ensurePreset(source)
        : action === 'update-group'
          ? await updateGroup(source)
          : await syncAgregarrCollectionGroupAction({ collectionIds: collectionIds(source) });
    await auditFinished(activity.id, {
      status: 'success',
      durationMs: Date.now() - startedAt,
      resultSummary: { action, completed: true }
    });
    return json(result);
  } catch (error) {
    const message = safeMessage(error);
    await auditFinished(activity.id, { status: 'error', durationMs: Date.now() - startedAt, error: message });
    return json({ message }, { status: 400 });
  }
}

function ensurePreset(source: Record<string, unknown>) {
  if (typeof source.preset !== 'string' || !agregarrPresetNames.includes(source.preset as AgregarrPreset)) {
    throw new Error('Choose a supported collection source.');
  }
  if (typeof source.mediaScope !== 'string' || !mediaScopes.includes(source.mediaScope as AgregarrMediaScope)) {
    throw new Error('Choose Movies, TV, or Movies + TV.');
  }
  return ensureAgregarrCollectionPresetAction({
    preset: source.preset as AgregarrPreset,
    mediaScope: source.mediaScope as AgregarrMediaScope,
    ...(typeof source.maxItems === 'number' ? { maxItems: source.maxItems } : {}),
    ...(typeof source.daysAhead === 'number' ? { daysAhead: source.daysAhead } : {})
  });
}

function updateGroup(source: Record<string, unknown>) {
  return updateAgregarrCollectionGroupAction({
    collectionIds: collectionIds(source),
    ...optionalBoolean(source, 'active'),
    ...optionalBoolean(source, 'showOnHome'),
    ...optionalBoolean(source, 'recommended'),
    ...optionalBoolean(source, 'randomizeHomeOrder')
  });
}

function collectionIds(source: Record<string, unknown>) {
  if (!Array.isArray(source.collectionIds) || !source.collectionIds.every((value) => typeof value === 'string')) {
    throw new Error('Choose a valid Agregarr collection group.');
  }
  return source.collectionIds;
}

function optionalBoolean(source: Record<string, unknown>, key: string) {
  return typeof source[key] === 'boolean' ? { [key]: source[key] as boolean } : {};
}

function safeMessage(error: unknown) {
  return redactSecrets(error instanceof Error ? error.message : 'The Agregarr action failed.');
}

import * as nodeCrypto from 'node:crypto';
import {
  readEnv,
  readJsonPreset,
  readSettings,
  redactEnv,
  type StackarrEnv,
  writeEnvConfig,
  writeJsonPreset,
  writeSettings
} from '@stackarr/core';
import {
  validateConfigurationPatch,
  validateTelemetryConsent,
  withGeneratedOptionalSecrets
} from '@stackarr/core/configurationValidation';
import type { NextRequest } from 'next/server';
import { hasValidStackarrSession, json, requireApiKey, setStackarrSessionCookie } from '../../../../../lib/api';
import { portlessHostActionIfNeeded } from '../../../../../lib/portlessSetup';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const env = readEnv();

  return json({
    config: redactEnv(env),
    settings: readSettings(),
    presets: {
      naming: readJsonPreset('naming'),
      downloads: readJsonPreset('downloads'),
      requests: readJsonPreset('requests')
    }
  });
}

export async function PUT(request: NextRequest) {
  const currentEnv = readEnv();
  const renewBrowserSession = hasValidStackarrSession(request, currentEnv);
  const existingApiKey = currentEnv.STACKARR_API_KEY?.trim() ?? '';
  if (existingApiKey) {
    const auth = requireApiKey(request);

    if (auth) {
      return auth;
    }
  }

  const beforeSettings = readSettings();
  const body = await request.json().catch(() => ({}));
  let afterSettings = beforeSettings;
  let nextEnv: StackarrEnv | null = null;

  const telemetryError = validateTelemetryConsent(
    beforeSettings.telemetry.enabled,
    body.settings?.telemetry?.enabled,
    body.confirmTelemetry
  );
  if (telemetryError) {
    return json({ accepted: false, error: telemetryError }, { status: 400 });
  }

  const config = typeof body.config === 'object' && body.config ? body.config : null;
  if (config && typeof config === 'object') {
    const validation = validateConfigurationPatch(config as StackarrEnv, currentEnv, body.currentPassword);
    if (validation) return json({ accepted: false, error: validation.error }, { status: validation.status });
    try {
      const requested = { ...(config as StackarrEnv) };
      if (requested.STACKARR_PG_BACKUP_URL === '') delete requested.STACKARR_PG_BACKUP_URL;
      nextEnv = writeEnvConfig(withGeneratedOptionalSecrets(requested, currentEnv));
    } catch (error) {
      return json(
        { accepted: false, error: error instanceof Error ? error.message : 'Invalid configuration.' },
        { status: 400 }
      );
    }
  }

  if (!nextEnv && !existingApiKey) {
    nextEnv = writeEnvConfig({ STACKARR_API_KEY: nodeCrypto.randomBytes(24).toString('hex') });
  }

  if (body.settings && typeof body.settings === 'object') {
    afterSettings = writeSettings(body.settings);
  }

  if (body.presets?.naming) {
    writeJsonPreset('naming', body.presets.naming);
  }

  if (body.presets?.downloads) {
    writeJsonPreset('downloads', body.presets.downloads);
  }

  if (body.presets?.requests) {
    writeJsonPreset('requests', body.presets.requests);
  }

  const portlessHostAction = portlessHostActionIfNeeded(beforeSettings, afterSettings);

  const response = json({
    accepted: true,
    apiKey: !existingApiKey && nextEnv?.STACKARR_API_KEY ? nextEnv.STACKARR_API_KEY : undefined,
    portlessHostAction: portlessHostAction ?? undefined
  });

  return renewBrowserSession ? setStackarrSessionCookie(response, request, nextEnv ?? readEnv()) : response;
}

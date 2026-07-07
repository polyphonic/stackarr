import crypto from 'node:crypto';
import { readEnv, readSettings, writeEnvConfig, writeSettings } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const env = readEnv();
  const settings = readSettings();

  return json({
    bindAddress: settings.host.bindAddress,
    port: settings.host.port,
    urlBase: settings.host.urlBase,
    enableSsl: settings.host.enableSsl,
    authenticationMethod: env.STACKARR_API_KEY ? settings.host.authenticationMethod : 'none',
    apiKey: env.STACKARR_API_KEY ? '********' : ''
  });
}

export async function PUT(request: NextRequest) {
  const env = readEnv();
  const existingApiKey = env.STACKARR_API_KEY?.trim() ?? '';
  if (existingApiKey) {
    const auth = requireApiKey(request);

    if (auth) {
      return auth;
    }
  }

  const body = await request.json().catch(() => ({}));
  const requestedApiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const nextApiKey =
    requestedApiKey && requestedApiKey !== '********'
      ? requestedApiKey
      : existingApiKey || crypto.randomBytes(24).toString('hex');
  env.STACKARR_API_KEY = nextApiKey;

  writeSettings({
    host: {
      authenticationMethod: body.authenticationMethod ?? 'forms',
      enableSsl: Boolean(body.enableSsl),
      urlBase: String(body.urlBase ?? ''),
      bindAddress: String(body.bindAddress ?? '127.0.0.1'),
      port: Number(body.port ?? 7777)
    }
  });
  writeEnvConfig({
    STACKARR_API_KEY: nextApiKey,
    STACKARR_BIND_IP: String(body.bindAddress ?? '127.0.0.1'),
    STACKARR_WEB_PORT: String(body.port ?? 7777)
  });

  return json({
    authenticationMethod: body.authenticationMethod ?? 'forms',
    apiKey: existingApiKey ? '********' : nextApiKey
  });
}

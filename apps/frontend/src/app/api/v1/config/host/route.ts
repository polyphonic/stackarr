import crypto from 'node:crypto';
import { readEnv, readSettings, writeEnvConfig, writeSettings } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function GET() {
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
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const body = await request.json().catch(() => ({}));
  const env = readEnv();
  env.STACKARR_API_KEY =
    body.apiKey && body.apiKey !== '********'
      ? String(body.apiKey)
      : env.STACKARR_API_KEY || crypto.randomBytes(24).toString('hex');

  writeSettings({
    host: {
      authenticationMethod: body.authenticationMethod ?? 'apikey',
      enableSsl: Boolean(body.enableSsl),
      urlBase: String(body.urlBase ?? ''),
      bindAddress: String(body.bindAddress ?? '127.0.0.1'),
      port: Number(body.port ?? 7777)
    }
  });
  writeEnvConfig({
    STACKARR_API_KEY: env.STACKARR_API_KEY,
    STACKARR_BIND_IP: String(body.bindAddress ?? '127.0.0.1'),
    STACKARR_WEB_PORT: String(body.port ?? 7777)
  });

  return json({
    authenticationMethod: body.authenticationMethod ?? 'apikey',
    apiKey: '********'
  });
}

import {
  type CloudflareTunnelRoute,
  getCloudflareRoutesAction,
  getServices,
  updateCloudflareRoutesAction
} from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../../lib/api';

const cloudflareServiceNames: Record<string, string> = {
  tinymediamanager: 'tinymm'
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ service: string }> }) {
  const auth = requireApiKey(request);
  if (auth) return auth;

  const { service } = await params;
  const summary = getServices().find((item) => item.name === service);
  if (!summary) return json({ error: 'Unknown app.' }, { status: 404 });

  const target = cloudflareServiceNames[service] ?? service;
  const state = getCloudflareRoutesAction();
  return json({
    supported: cloudflareTargetSupported(target),
    target,
    route: state.routes.find((route) => route.service === target) ?? null,
    access: state.access,
    tunnelConfigured: Boolean(state.tunnelId)
  });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ service: string }> }) {
  const auth = requireApiKey(request);
  if (auth) return auth;

  const { service } = await params;
  const summary = getServices().find((item) => item.name === service);
  if (!summary) return json({ error: 'Unknown app.' }, { status: 404 });

  const target = cloudflareServiceNames[service] ?? service;
  if (!cloudflareTargetSupported(target)) {
    return json({ error: 'This helper app is not intended for direct public access.' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const hostname = typeof body.hostname === 'string' ? body.hostname : '';
  const access = typeof body.access === 'boolean' ? body.access : true;
  const state = getCloudflareRoutesAction();
  const otherRoutes = state.routes.filter((route) => route.service !== target);
  const routes: CloudflareTunnelRoute[] = hostname
    ? [...otherRoutes, { hostname, service: target, access }]
    : otherRoutes;
  const result = updateCloudflareRoutesAction({ routes });

  return json({
    ...result,
    route: result.routes.find((route) => route.service === target) ?? null
  });
}

function cloudflareTargetSupported(service: string) {
  return [
    'stackarr',
    'pulsarr',
    'maintainerr',
    'tracearr',
    'bookorbit',
    'immich',
    'romm',
    'seerr',
    'plex',
    'jellyfin',
    'tinymm',
    'radarr',
    'sonarr',
    'lidarr',
    'prowlarr',
    'bazarr',
    'transmission',
    'qbittorrent'
  ].includes(service);
}

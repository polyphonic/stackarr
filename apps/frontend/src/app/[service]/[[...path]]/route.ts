import {
  directPortlessBrowserUrl,
  getServices,
  readSettings,
  serviceBrowserPath,
  serviceNameFromRouteSlug,
  serviceRouteSlug
} from '@stackarr/core';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type RouteParams = {
  service: string;
  path?: string[];
};

export async function GET(request: Request, { params }: { params: Promise<RouteParams> }) {
  const settings = readSettings();

  if (settings.ui.serviceUrlMode !== 'portless') {
    return notFound();
  }

  const { service, path } = await params;
  const normalizedSlug = normalizeRouteSlug(service);
  const targetName = serviceNameFromRouteSlug(normalizedSlug);
  const target = getServices().find(
    (candidate) => candidate.name === targetName || serviceRouteSlug(candidate.name) === normalizedSlug
  );

  if (!target || target.name === 'stackarr' || target.mode === 'disabled' || !target.port) {
    return notFound();
  }

  const requestUrl = new URL(request.url);
  const targetPath = path?.length
    ? `/${path.map((segment) => encodeURIComponent(segment)).join('/')}`
    : serviceBrowserPath(target.name);
  const redirectUrl = new URL(directPortlessBrowserUrl(target.name, settings, targetPath));
  redirectUrl.search = requestUrl.search;

  return NextResponse.redirect(redirectUrl, 307);
}

export const HEAD = GET;

function normalizeRouteSlug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function notFound() {
  return NextResponse.json({ message: 'Service route not found.' }, { status: 404 });
}

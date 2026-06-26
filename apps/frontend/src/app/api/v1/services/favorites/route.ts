import { listServiceFavoritesAction, updateServiceFavoritesAction } from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

export async function GET() {
  return json({ favorites: listServiceFavoritesAction() });
}

export async function PUT(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const body = await request.json().catch(() => ({}));
  const names = Array.isArray(body.names)
    ? body.names
    : Array.isArray(body.favorites)
      ? body.favorites.map((favorite: unknown) => (typeof favorite === 'string' ? favorite : favoriteName(favorite)))
      : [];

  return json(updateServiceFavoritesAction({ names }));
}

function favoriteName(value: unknown) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  return (value as { name?: unknown }).name;
}

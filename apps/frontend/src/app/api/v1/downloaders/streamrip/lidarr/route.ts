import {
  downloadLidarrAlbumWithStreamripAction,
  listLidarrStreamripAlbumsAction,
  prepareLidarrStreamripAlbumAction
} from '@stackarr/core/actions/lidarrStreamrip';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../../lib/api';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const albumId = Number(searchParams.get('albumId') ?? 0);

  try {
    if (albumId > 0) {
      return json(await prepareLidarrStreamripAlbumAction({ albumId }));
    }

    return json(
      await listLidarrStreamripAlbumsAction({
        query: searchParams.get('query') ?? undefined,
        missingOnly: searchParams.get('missingOnly') === 'true',
        limit: Number(searchParams.get('limit') ?? 100),
        offset: Number(searchParams.get('offset') ?? 0)
      })
    );
  } catch (error) {
    return json({ message: error instanceof Error ? error.message : 'Could not read Lidarr albums.' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const auth = requireApiKey(request);

  if (auth) {
    return auth;
  }

  const body = await request.json().catch(() => ({}));
  const albumId = Number(body.albumId ?? 0);

  if (!Number.isFinite(albumId) || albumId <= 0) {
    return json({ message: 'Lidarr albumId is required.' }, { status: 400 });
  }

  try {
    return json(
      await downloadLidarrAlbumWithStreamripAction({
        albumId,
        url: typeof body.url === 'string' ? body.url : undefined,
        source: typeof body.source === 'string' ? body.source : undefined
      })
    );
  } catch (error) {
    return json(
      { message: error instanceof Error ? error.message : 'Could not start Lidarr Streamrip download.' },
      { status: 400 }
    );
  }
}

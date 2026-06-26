import { requestJson, withQuery } from '../clients/http';
import { serviceApiKey, serviceBaseUrl } from '../clients/serviceConfig';
import { type StreamripSource, startStreamripDownloadAction, startStreamripSearchDownloadAction } from './streamrip';

type LidarrAlbum = {
  id: number;
  title?: string;
  foreignAlbumId?: string;
  releaseDate?: string;
  monitored?: boolean;
  statistics?: { percentOfTracks?: number; trackFileCount?: number; trackCount?: number };
  artistId?: number;
  artist?: LidarrArtist;
};

type LidarrArtist = {
  id: number;
  artistName?: string;
  name?: string;
  foreignArtistId?: string;
};

export async function listLidarrStreamripAlbumsAction(
  input: { query?: string; missingOnly?: boolean; limit?: number; offset?: number } = {}
) {
  const albums = await lidarrGet<LidarrAlbum[]>('album');
  const normalizedQuery = String(input.query ?? '')
    .trim()
    .toLowerCase();
  const limit = Math.max(1, Math.min(Number(input.limit ?? 100) || 100, 500));
  const offset = Math.max(0, Number(input.offset ?? 0) || 0);

  const filtered = albums
    .map((album) => toPreparedAlbum(album))
    .filter((item) => {
      const haystack = `${item.artist?.name ?? ''} ${item.album.title}`.toLowerCase();
      const missing = (item.album.percentOfTracks ?? 0) < 100;
      return (!normalizedQuery || haystack.includes(normalizedQuery)) && (!input.missingOnly || missing);
    })
    .sort((a, b) => Number(b.album.monitored) - Number(a.album.monitored) || a.query.localeCompare(b.query));

  const items = filtered.slice(offset, offset + limit);

  return { albums: items, total: filtered.length, offset, limit, hasMore: offset + items.length < filtered.length };
}

export async function prepareLidarrStreamripAlbumAction(input: { albumId: number }) {
  const album = await lidarrGet<LidarrAlbum>(`album/${input.albumId}`);
  return toPreparedAlbum(album);
}

export async function downloadLidarrAlbumWithStreamripAction(input: {
  albumId: number;
  url?: string;
  source?: StreamripSource;
}) {
  const prepared = await prepareLidarrStreamripAlbumAction({ albumId: input.albumId });
  const url = String(input.url ?? '').trim();
  const result = url
    ? await startStreamripDownloadAction({ url })
    : await startStreamripSearchDownloadAction({
        source: input.source ?? 'deezer',
        mediaType: 'album',
        query: prepared.query,
        lidarrAlbumId: prepared.album.id,
        lidarrAlbumTitle: prepared.album.title,
        lidarrArtistName: prepared.artist?.name
      });

  return {
    accepted: true,
    lidarr: prepared,
    streamrip: result.job
  };
}

function toPreparedAlbum(album: LidarrAlbum) {
  const artist = album.artist;
  const artistName = artist?.artistName ?? artist?.name ?? '';
  const albumTitle = album.title ?? '';
  const year = album.releaseDate ? new Date(album.releaseDate).getFullYear() : undefined;
  const query = [artistName, albumTitle, year].filter(Boolean).join(' ');

  return {
    album: {
      id: album.id,
      title: albumTitle,
      foreignAlbumId: album.foreignAlbumId,
      releaseDate: album.releaseDate,
      monitored: album.monitored,
      percentOfTracks: album.statistics?.percentOfTracks,
      trackFileCount: album.statistics?.trackFileCount,
      trackCount: album.statistics?.trackCount
    },
    artist: artist
      ? {
          id: artist.id,
          name: artistName,
          foreignArtistId: artist.foreignArtistId
        }
      : undefined,
    query,
    suggestedSources: ['deezer', 'qobuz', 'tidal', 'soundcloud']
  };
}

async function lidarrGet<T>(path: string, query: Record<string, string | number | boolean | undefined> = {}) {
  const baseUrl = serviceBaseUrl('lidarr');
  const apiKey = serviceApiKey('lidarr');
  if (!apiKey) throw new Error('Missing API key for Lidarr. Save the Lidarr API key in Stackarr configuration.');
  return requestJson<T>(withQuery(`${baseUrl}/api/v1/${path.replace(/^\//, '')}`, { ...query, apikey: apiKey }));
}

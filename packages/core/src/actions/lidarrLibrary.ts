import { stat } from 'node:fs/promises';
import path from 'node:path';
import { servarrGet, servarrPost, servarrPut } from '../clients/servarr';
import { readEnv, writeEnvConfig } from '../env';
import { runStackarrCommandAction } from './commands';
import { getDockerContainerOverviewAction } from './containers';

type LidarrHealthItem = {
  type?: string;
  source?: string;
  message?: string;
  wikiUrl?: string;
};

type LidarrRootFolder = {
  id?: number;
  path?: string;
  accessible?: boolean;
  freeSpace?: number;
  unmappedFolders?: unknown[];
};

type LidarrDownloadConfig = Record<string, unknown> & {
  id?: number;
  enableCompletedDownloadHandling?: boolean;
  removeCompletedDownloads?: boolean;
};

type LidarrMediaManagementConfig = Record<string, unknown> & {
  id?: number;
  renameTracks?: boolean;
  replaceIllegalCharacters?: boolean;
  skipFreeSpaceCheckWhenImporting?: boolean;
  minimumFreeSpaceWhenImporting?: number;
  copyUsingHardlinks?: boolean;
  importExtraFiles?: boolean;
};

type LidarrIndexer = {
  id?: number;
  name?: string;
  protocol?: string;
  enableRss?: boolean;
  enableAutomaticSearch?: boolean;
  enableInteractiveSearch?: boolean;
  priority?: number;
};

type LidarrArtist = {
  id?: number;
  path?: string;
  rootFolderPath?: string;
  monitored?: boolean;
  statistics?: {
    trackFileCount?: number;
    trackCount?: number;
    albumCount?: number;
  };
};

const lidarrContainerRoot = '/music';

export async function getLidarrLibraryStatusAction() {
  const [system, health, roots, downloadConfig, mediaManagement, indexers, artists, queue] = await Promise.all([
    servarrGet<Record<string, unknown>>('lidarr', 'system/status', {}, 'v1'),
    servarrGet<LidarrHealthItem[]>('lidarr', 'health', {}, 'v1'),
    servarrGet<LidarrRootFolder[]>('lidarr', 'rootfolder', {}, 'v1'),
    servarrGet<LidarrDownloadConfig>('lidarr', 'config/downloadclient', {}, 'v1'),
    servarrGet<LidarrMediaManagementConfig>('lidarr', 'config/mediamanagement', {}, 'v1'),
    servarrGet<LidarrIndexer[]>('lidarr', 'indexer', {}, 'v1'),
    servarrGet<LidarrArtist[]>('lidarr', 'artist', {}, 'v1'),
    servarrGet<{ totalRecords?: number }>('lidarr', 'queue', { page: 1, pageSize: 1 }, 'v1')
  ]);

  const artistsByRoot = new Map<string, { artists: number; monitored: number; trackFiles: number; tracks: number }>();
  for (const artist of artists) {
    const root = artist.rootFolderPath || '(unset)';
    const summary = artistsByRoot.get(root) ?? { artists: 0, monitored: 0, trackFiles: 0, tracks: 0 };
    summary.artists += 1;
    if (artist.monitored) summary.monitored += 1;
    summary.trackFiles += artist.statistics?.trackFileCount ?? 0;
    summary.tracks += artist.statistics?.trackCount ?? 0;
    artistsByRoot.set(root, summary);
  }

  return {
    system: {
      version: stringValue(system.version),
      startTime: stringValue(system.startTime),
      isDocker: system.isDocker === true,
      databaseType: stringValue(system.databaseType)
    },
    health: health.map((item) => ({
      type: item.type ?? 'unknown',
      source: item.source ?? 'Lidarr',
      message: item.message ?? '',
      wikiUrl: item.wikiUrl
    })),
    roots: roots.map((root) => ({
      id: root.id,
      path: root.path,
      accessible: root.accessible,
      freeSpace: root.freeSpace,
      unmappedFolderCount: Array.isArray(root.unmappedFolders) ? root.unmappedFolders.length : 0
    })),
    manualLibrary: {
      containerRoot: lidarrContainerRoot,
      completedDownloadHandling: downloadConfig.enableCompletedDownloadHandling === true,
      removeCompletedDownloads: downloadConfig.removeCompletedDownloads === true,
      renameTracks: mediaManagement.renameTracks === true,
      copyUsingHardlinks: mediaManagement.copyUsingHardlinks === true,
      importExtraFiles: mediaManagement.importExtraFiles === true
    },
    indexers: indexers.map((indexer) => ({
      id: indexer.id,
      name: indexer.name,
      protocol: indexer.protocol,
      enableRss: indexer.enableRss === true,
      enableAutomaticSearch: indexer.enableAutomaticSearch === true,
      enableInteractiveSearch: indexer.enableInteractiveSearch === true,
      priority: indexer.priority
    })),
    library: {
      artists: artists.length,
      monitoredArtists: artists.filter((artist) => artist.monitored).length,
      roots: Object.fromEntries(artistsByRoot),
      queuedDownloads: queue.totalRecords ?? 0
    }
  };
}

export async function configureLidarrManualLibraryAction(input: { rescan?: boolean } = {}) {
  const [downloadConfig, mediaManagement, existingRoots] = await Promise.all([
    servarrGet<LidarrDownloadConfig>('lidarr', 'config/downloadclient', {}, 'v1'),
    servarrGet<LidarrMediaManagementConfig>('lidarr', 'config/mediamanagement', {}, 'v1'),
    servarrGet<LidarrRootFolder[]>('lidarr', 'rootfolder', {}, 'v1')
  ]);
  const changed: string[] = [];

  if (downloadConfig.enableCompletedDownloadHandling !== false) {
    await servarrPut(
      'lidarr',
      `config/downloadclient/${requiredId(downloadConfig.id, 'download client config')}`,
      { ...downloadConfig, enableCompletedDownloadHandling: false },
      'v1'
    );
    changed.push('completedDownloadHandling');
  }

  if (mediaManagement.renameTracks !== false) {
    await servarrPut(
      'lidarr',
      `config/mediamanagement/${requiredId(mediaManagement.id, 'media management config')}`,
      { ...mediaManagement, renameTracks: false },
      'v1'
    );
    changed.push('renameTracks');
  }

  if (!existingRoots.some((root) => root.path === lidarrContainerRoot)) {
    const [qualityProfiles, metadataProfiles] = await Promise.all([
      servarrGet<Array<{ id?: number }>>('lidarr', 'qualityprofile', {}, 'v1'),
      servarrGet<Array<{ id?: number }>>('lidarr', 'metadataprofile', {}, 'v1')
    ]);
    await servarrPost(
      'lidarr',
      'rootfolder',
      {
        path: lidarrContainerRoot,
        name: 'Music',
        defaultQualityProfileId: firstId(qualityProfiles, 'quality profile'),
        defaultMetadataProfileId: firstId(metadataProfiles, 'metadata profile')
      },
      'v1'
    );
    changed.push('rootFolder');
  }

  let command: { id?: number; status?: string } | undefined;
  if (input.rescan !== false) {
    const started = await servarrPost<{ id?: number }>(
      'lidarr',
      'command',
      { name: 'RescanFolders', folders: [lidarrContainerRoot] },
      'v1'
    );
    command = await waitForLidarrCommand(started.id);
  }

  const status = await getLidarrLibraryStatusAction();
  return {
    updated: changed.length > 0,
    changed,
    rescan: command ? { id: command.id, status: command.status } : undefined,
    status
  };
}

export async function updateLidarrMusicMountAction(input: {
  musicRoot: string;
  dryRun?: boolean;
  confirmMountChange?: boolean;
}) {
  const env = readEnv();
  const mediaRoot = path.resolve(env.MEDIA_ROOT);
  const requestedRoot = path.resolve(input.musicRoot);
  if (!path.isAbsolute(input.musicRoot)) throw new Error('musicRoot must be an absolute host path.');
  if (!isWithin(mediaRoot, requestedRoot)) throw new Error('musicRoot must stay within the configured MEDIA_ROOT.');
  const info = await stat(requestedRoot);
  if (!info.isDirectory()) throw new Error('musicRoot must point to an existing directory.');

  const plan = {
    dryRun: true as const,
    changed: requestedRoot !== path.resolve(env.MUSIC_ROOT),
    previousHostRoot: env.MUSIC_ROOT,
    requestedHostRoot: requestedRoot,
    containerRoot: lidarrContainerRoot,
    service: 'lidarr'
  };
  if (input.dryRun !== false) return plan;
  if (input.confirmMountChange !== true) {
    throw new Error('Set confirmMountChange=true to persist MUSIC_ROOT and recreate only the Lidarr container.');
  }

  const previousRoot = env.MUSIC_ROOT;
  writeEnvConfig({ MUSIC_ROOT: requestedRoot });
  try {
    await runStackarrCommandAction({
      command: 'ServiceRuntimeApply',
      args: ['lidarr'],
      confirmDangerous: true,
      reason: `Apply the approved Lidarr music mount ${requestedRoot} -> ${lidarrContainerRoot}`
    });
  } catch (error) {
    writeEnvConfig({ MUSIC_ROOT: previousRoot });
    throw error;
  }

  const overview = await getDockerContainerOverviewAction();
  const lidarr = overview.containers.find(
    (container) => container.name === 'lidarr' || container.composeService === 'lidarr'
  );
  const mount = lidarr?.mounts.find((item) => item.destination === lidarrContainerRoot);
  if (!lidarr?.running || mount?.source !== requestedRoot || mount.writable !== true) {
    throw new Error('Lidarr restarted, but the live /music mount did not match the requested writable host path.');
  }

  const status = await getLidarrLibraryStatusAction();
  return {
    dryRun: false as const,
    changed: plan.changed,
    hostRoot: requestedRoot,
    containerRoot: lidarrContainerRoot,
    writable: true,
    containerRunning: true,
    status
  };
}

async function waitForLidarrCommand(commandId: number | undefined) {
  if (!commandId) throw new Error('Lidarr did not return a command id for the library rescan.');
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const command = await servarrGet<{ id?: number; status?: string; message?: string }>(
      'lidarr',
      `command/${commandId}`,
      {},
      'v1'
    );
    const status = command.status?.toLowerCase();
    if (status === 'completed') return command;
    if (status && ['failed', 'aborted', 'cancelled'].includes(status)) {
      throw new Error(`Lidarr library rescan ${status}: ${command.message ?? 'no message returned'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Timed out waiting for Lidarr library rescan completion.');
}

function requiredId(value: number | undefined, label: string) {
  if (!Number.isInteger(value) || (value ?? 0) < 1) throw new Error(`Lidarr returned no usable ${label} id.`);
  return value as number;
}

function firstId(values: Array<{ id?: number }>, label: string) {
  const value = values.find((item) => Number.isInteger(item.id))?.id;
  if (!value) throw new Error(`Lidarr has no usable ${label}.`);
  return value;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

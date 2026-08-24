import { copyFile, link, lstat, mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import path from 'node:path';
import { io } from 'socket.io-client';
import { ServiceApiError, withQuery } from '../clients/http';
import { serviceBaseUrl } from '../clients/serviceConfig';
import { readEnv } from '../env';
import { readNativeAppAction } from './apps';
import { questarrRequest } from './questarr';

type JsonRecord = Record<string, unknown>;
type ImportMode = 'hardlink' | 'copy';
type RegisteredGame = {
  igdbId: number;
  questarrGameId: string;
  title: string;
  fsSlug: string;
  createdAt: string;
};
type ImportedDownload = { importedAt: string; destination: string; files: number };
type ImportState = {
  version: 1;
  games: RegisteredGame[];
  imports: Record<string, ImportedDownload>;
  pendingScanSlugs: string[];
  reconcileCursor: number;
};

export async function requestQuestarrGameAction(input: { title: string; platform?: string; fsSlug?: string }) {
  const title = boundedText(input.title, 200, 'title');
  const requestedPlatform = input.platform ? boundedText(input.platform, 200, 'platform') : undefined;
  const candidates = uniqueGames(
    records(
      await questarrRequest<unknown>(
        withQuery(`${serviceBaseUrl('questarr')}/api/igdb/search`, { q: title, limit: 20 })
      )
    ).filter((game) => normalized(gameTitle(game)) === normalized(title))
  );
  const matches = requestedPlatform
    ? candidates.filter((game) =>
        gamePlatforms(game).some((platform) => normalized(platform) === normalized(requestedPlatform))
      )
    : candidates;

  const requiresPlatformSelection =
    !requestedPlatform && matches.length === 1 && gamePlatforms(matches[0]!).length !== 1;
  if (matches.length !== 1 || requiresPlatformSelection) {
    return {
      status: matches.length === 0 ? 'not-found' : 'ambiguous',
      title,
      ...(requestedPlatform ? { platform: requestedPlatform } : {}),
      ...(matches.length > 1 || requiresPlatformSelection
        ? { candidates: matches.slice(0, 10).map(summarizeCandidate) }
        : {})
    };
  }

  const selected = matches[0]!;
  const selectedId = numberValue(selected.id) ?? numberValue(selected.igdbId);
  if (selectedId === undefined) throw new Error('Questarr returned an IGDB game without an id.');
  const igdbId = positiveInteger(selectedId, 'IGDB game id');
  const selectedTitle = gameTitle(selected);
  if (!selectedTitle) throw new Error('Questarr returned an IGDB game without a title.');
  const platform = requestedPlatform ? matchingPlatform(selected, requestedPlatform) : firstPlatform(selected);
  if (!platform) throw new Error('Questarr returned the selected game without a usable platform.');
  const fsSlug = await validatedRommPlatformSlug(platform, input.fsSlug);
  await assertRommPlatform(fsSlug);

  let game: JsonRecord;
  let alreadyInCollection = false;
  try {
    game = record(
      await questarrRequest<unknown>(`${serviceBaseUrl('questarr')}/api/games`, {
        method: 'POST',
        body: { ...selected, igdbId, title: selectedTitle, status: 'wanted', platform }
      })
    );
  } catch (error) {
    const existing = record(
      error instanceof ServiceApiError && error.status === 409 ? record(error.details).game : undefined
    );
    if (!scalarId(existing.id)) throw error;
    game = existing;
    alreadyInCollection = true;
  }
  const questarrGameId = scalarId(game.id);
  if (!questarrGameId) throw new Error('Questarr added the game without returning its id.');

  const entry = await persistGameMapping({ igdbId, questarrGameId, title: selectedTitle, fsSlug });
  return {
    status: 'wanted',
    alreadyInCollection,
    game: { igdbId: entry.igdbId, questarrGameId: entry.questarrGameId, title: entry.title, fsSlug: entry.fsSlug }
  };
}

export async function registerQuestarrRommGameAction(input: { igdbId: number; fsSlug: string }) {
  const igdbId = positiveInteger(input.igdbId, 'igdbId');
  const fsSlug = platformSlug(input.fsSlug);
  await assertRommPlatform(fsSlug);
  const detail = record(await questarrRequest<unknown>(`${serviceBaseUrl('questarr')}/api/igdb/game/${igdbId}`));
  const title = text(detail.title) ?? text(detail.name);
  if (!title) throw new Error('Questarr returned an IGDB game without a title.');
  const platform = firstPlatform(detail);
  if (!platform) throw new Error('Questarr returned the IGDB game without a usable platform.');
  await validatedRommPlatformSlug(platform, fsSlug);
  let game: JsonRecord;
  try {
    game = record(
      await questarrRequest<unknown>(`${serviceBaseUrl('questarr')}/api/games`, {
        method: 'POST',
        body: { ...detail, igdbId, title, status: 'wanted', platform }
      })
    );
  } catch (error) {
    const existing = record(
      error instanceof ServiceApiError && error.status === 409 ? record(error.details).game : undefined
    );
    if (!scalarId(existing.id)) throw error;
    game = existing;
  }
  const questarrGameId = scalarId(game.id);
  if (!questarrGameId) throw new Error('Questarr added the game without returning its id.');

  const entry = await persistGameMapping({ igdbId, questarrGameId, title, fsSlug });
  return { registered: true, game: entry };
}

export async function listQuestarrRommImportMappingsAction() {
  const state = await loadState();
  return {
    total: state.games.length,
    importedDownloads: Object.keys(state.imports).length,
    pendingScanSlugs: state.pendingScanSlugs,
    mappings: state.games.map((game) => ({
      ...game,
      imports: Object.entries(state.imports)
        .filter(([key]) => key.startsWith(`${game.questarrGameId}:`))
        .map(([downloadKey, imported]) => ({ downloadKey, ...imported }))
    }))
  };
}

export async function syncRommOwnedGamesAction(input: { dryRun?: boolean; limit?: number } = {}) {
  const dryRun = input.dryRun ?? true;
  const limit = boundedInteger(input.limit ?? 20, 1, 20, 'limit');
  const [roms, questarrGames] = await Promise.all([
    listRommLibraryRecords(),
    questarrRequest<unknown>(withQuery(`${serviceBaseUrl('questarr')}/api/games`, { includeHidden: true }))
  ]);
  const liveRoms = await filesystemPresentRoms(roms);
  const byIgdb = new Map<number, JsonRecord>();
  for (const rom of liveRoms) {
    const rawId = numberValue(rom.igdb_id);
    if (rawId === undefined || rawId < 1 || byIgdb.has(rawId)) continue;
    byIgdb.set(rawId, rom);
  }
  const existingByIgdb = new Map<number, JsonRecord>();
  for (const game of records(questarrGames)) {
    const rawId = numberValue(game.igdbId);
    if (rawId !== undefined && rawId > 0) existingByIgdb.set(rawId, game);
  }

  const mutations = [...byIgdb.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([igdbId, rom]) => {
      const existing = existingByIgdb.get(igdbId);
      if ((text(existing?.status) ?? '').toLowerCase() === 'owned') return [];
      return [{ igdbId, rom, existing }];
    });
  const selected = mutations.slice(0, limit);
  const results: Array<Record<string, unknown>> = [];
  if (!dryRun) {
    for (const item of selected) {
      const title = text(item.rom.name);
      if (!title) {
        results.push({ igdbId: item.igdbId, status: 'rejected', reason: 'RomM record has no title.' });
        continue;
      }
      const existingId = scalarId(item.existing?.id);
      if (existingId) {
        await questarrRequest<unknown>(
          `${serviceBaseUrl('questarr')}/api/games/${encodeURIComponent(existingId)}/status`,
          { method: 'PATCH', body: { status: 'owned' } }
        );
        results.push({ igdbId: item.igdbId, title, status: 'marked-owned' });
        continue;
      }
      const metadata = record(item.rom.igdb_metadata);
      const platforms = records(metadata.platforms)
        .map((platform) => text(platform.name))
        .filter((platform): platform is string => Boolean(platform));
      const platform = text(item.rom.platform_display_name) ?? text(item.rom.platform_fs_slug);
      let coverUrl = text(item.rom.url_cover);
      if (!coverUrl) {
        try {
          const match = record(
            await questarrRequest<unknown>(`${serviceBaseUrl('questarr')}/api/igdb/game/${item.igdbId}`)
          );
          coverUrl = text(match.coverUrl);
        } catch {
          // Ownership is authoritative even when optional artwork enrichment is unavailable.
        }
      }
      try {
        await questarrRequest<unknown>(`${serviceBaseUrl('questarr')}/api/games`, {
          method: 'POST',
          body: {
            igdbId: item.igdbId,
            title,
            status: 'owned',
            source: 'api',
            ...(text(item.rom.summary) ? { summary: text(item.rom.summary) } : {}),
            ...(coverUrl ? { coverUrl } : {}),
            ...(platforms.length > 0 ? { platforms } : platform ? { platforms: [platform] } : {})
          }
        });
        results.push({ igdbId: item.igdbId, title, status: 'added-owned' });
      } catch (error) {
        const existing = record(
          error instanceof ServiceApiError && error.status === 409 ? record(error.details).game : undefined
        );
        const gameId = scalarId(existing.id);
        if (!gameId) throw error;
        await questarrRequest<unknown>(`${serviceBaseUrl('questarr')}/api/games/${encodeURIComponent(gameId)}/status`, {
          method: 'PATCH',
          body: { status: 'owned' }
        });
        results.push({ igdbId: item.igdbId, title, status: 'marked-owned' });
      }
    }
  }

  const unidentified = liveRoms.filter((rom) => numberValue(rom.igdb_id) === undefined);
  return {
    dryRun,
    romm: {
      indexed: roms.length,
      presentOnFilesystem: liveRoms.length,
      missingFromFilesystem: roms.length - liveRoms.length,
      uniqueIdentifiedGames: byIgdb.size,
      duplicateVariants: liveRoms.length - unidentified.length - byIgdb.size,
      unidentified: unidentified.length,
      unidentifiedSample: unidentified.slice(0, 20).map((rom) => ({
        rommId: scalarId(rom.id),
        title: text(rom.name),
        fsSlug: text(rom.platform_fs_slug)
      }))
    },
    questarr: {
      alreadyOwned: byIgdb.size - mutations.length,
      pendingMutations: mutations.length,
      processed: dryRun ? 0 : results.length,
      remaining: dryRun ? mutations.length : Math.max(0, mutations.length - results.length)
    },
    ...(dryRun
      ? {
          preview: selected.map((item) => ({
            igdbId: item.igdbId,
            title: text(item.rom.name),
            action: item.existing ? 'mark-owned' : 'add-owned'
          }))
        }
      : { results })
  };
}

export async function reconcileQuestarrRommImportsAction(
  input: { dryRun?: boolean; mode?: ImportMode; limit?: number } = {}
) {
  const dryRun = input.dryRun ?? true;
  const env = readEnv();
  if (!dryRun && env.QUESTARR_ROMM_IMPORT_ENABLED !== 'true') {
    throw new Error('Secure Questarr to RomM import is disabled. Enable it before executing reconciliation.');
  }
  if (!dryRun && env.QUESTARR_ROMM_CLAMAV_ENABLED === 'false') {
    throw new Error('Secure Questarr to RomM import requires ClamAV.');
  }
  const mode = input.mode ?? importMode(env.QUESTARR_ROMM_TRANSFER_MODE);
  const limit = boundedInteger(input.limit ?? numberFromText(env.QUESTARR_ROMM_IMPORT_LIMIT) ?? 10, 1, 100, 'limit');
  if (!['hardlink', 'copy'].includes(mode)) throw new Error('mode must be hardlink or copy.');
  const state = await loadState();
  const results: Array<Record<string, unknown>> = await discoverQuestarrCollectionMappings(state, !dryRun);
  const pendingScanSlugs = new Set(state.pendingScanSlugs);
  let considered = 0;
  let mappingsRead = 0;
  const mappingReadLimit = Math.min(state.games.length, Math.max(50, limit * 5));

  for (let step = 0; step < mappingReadLimit; step += 1) {
    if (considered >= limit) break;
    const mapping = state.games[(state.reconcileCursor + step) % state.games.length]!;
    mappingsRead += 1;
    const downloads = records(
      await questarrRequest<unknown>(
        `${serviceBaseUrl('questarr')}/api/games/${encodeURIComponent(mapping.questarrGameId)}/downloads`
      )
    );
    for (const download of downloads) {
      if (considered >= limit) break;
      if ((text(download.status) ?? '').toLowerCase() !== 'completed') continue;
      considered += 1;
      const hash = text(download.downloadHash) ?? text(download.hash) ?? scalarId(download.id);
      const downloaderId = scalarId(download.downloaderId);
      if (!hash || !downloaderId) {
        results.push({
          gameId: mapping.questarrGameId,
          status: 'rejected',
          reason: 'Tracked Questarr download has no downloader id or stable hash.'
        });
        continue;
      }
      const key = `${mapping.questarrGameId}:${hash.toLowerCase()}`;
      if (state.imports[key]) {
        results.push({ downloadKey: key, status: 'already-imported', destination: state.imports[key].destination });
        continue;
      }
      try {
        const details = record(
          await questarrRequest<unknown>(
            `${serviceBaseUrl('questarr')}/api/downloaders/${encodeURIComponent(downloaderId)}/downloads/${encodeURIComponent(hash)}/details`
          )
        );
        const progress = numberValue(details.progress);
        if (progress !== undefined && progress < 100) {
          throw new Error('Questarr downloader still reports an incomplete payload.');
        }
        const source = await completedDownloadPath(details, downloadsRoot());
        const destination = await safeRommDestination(mapping.fsSlug, sanitizeTitle(mapping.title));
        if (dryRun) {
          results.push({ downloadKey: key, status: 'would-import', source, destination, mode });
          continue;
        }
        await clamdScan(source);
        const files = await importTree(source, destination, mode);
        state.imports[key] = { importedAt: new Date().toISOString(), destination, files };
        if (files > 0) pendingScanSlugs.add(mapping.fsSlug);
        state.pendingScanSlugs = [...pendingScanSlugs].sort();
        await saveState(state);
        results.push({ downloadKey: key, status: 'imported', destination, files, mode });
      } catch (error) {
        results.push({
          downloadKey: key,
          status: 'rejected',
          reason: error instanceof Error ? error.message : 'Import failed.'
        });
      }
    }
  }
  if (!dryRun && state.games.length > 0) {
    state.reconcileCursor = (state.reconcileCursor + mappingsRead) % state.games.length;
    await saveState(state);
  }
  const rescan =
    dryRun || pendingScanSlugs.size === 0
      ? { queued: false, verified: false, platformFsSlugs: [] as string[] }
      : await queueRommScan([...pendingScanSlugs]);
  if (rescan.verified) {
    state.pendingScanSlugs = state.pendingScanSlugs.filter((slug) => !rescan.platformFsSlugs.includes(slug));
    await saveState(state);
  }
  return {
    dryRun,
    mode,
    limit,
    registeredGames: state.games.length,
    mappingsRead,
    results,
    rescanNeeded: state.pendingScanSlugs.length > 0,
    rescan
  };
}

async function discoverQuestarrCollectionMappings(state: ImportState, apply: boolean) {
  const games = records(await questarrRequest<unknown>(`${serviceBaseUrl('questarr')}/api/games?includeHidden=false`));
  const results: Array<Record<string, unknown>> = [];
  let changed = false;
  for (const game of games) {
    const status = (text(game.status) ?? 'wanted').toLowerCase();
    if (!['wanted', 'downloading', 'completed'].includes(status)) continue;
    const questarrGameId = scalarId(game.id);
    const igdbIdValue = numberValue(game.igdbId) ?? numberValue(game.igdb_id);
    const title = gameTitle(game);
    if (!questarrGameId || igdbIdValue === undefined || !title) continue;
    if (state.games.some((mapping) => mapping.questarrGameId === questarrGameId)) continue;

    const slugs = new Set<string>();
    for (const platform of gamePlatforms(game)) {
      try {
        slugs.add(await resolveRommPlatformSlug(platform));
      } catch {
        // A collection game can list platforms that are not present in this RomM library.
      }
    }
    if (slugs.size !== 1) {
      results.push({
        gameId: questarrGameId,
        title,
        status: 'needs-platform-selection',
        platforms: gamePlatforms(game)
      });
      continue;
    }
    const fsSlug = [...slugs][0]!;
    results.push({ gameId: questarrGameId, title, fsSlug, status: apply ? 'mapping-registered' : 'would-register' });
    if (apply) {
      state.games.push({
        igdbId: positiveInteger(igdbIdValue, 'IGDB game id'),
        questarrGameId,
        title,
        fsSlug,
        createdAt: new Date().toISOString()
      });
      changed = true;
    }
  }
  if (changed) await saveState(state);
  return results;
}

async function persistGameMapping(input: Omit<RegisteredGame, 'createdAt'>) {
  const state = await loadState();
  const existingIndex = state.games.findIndex((candidate) => candidate.igdbId === input.igdbId);
  const existing = existingIndex >= 0 ? state.games[existingIndex] : undefined;
  if (existing && (existing.questarrGameId !== input.questarrGameId || existing.fsSlug !== input.fsSlug)) {
    throw new Error(
      `IGDB game ${input.igdbId} is already mapped to Questarr game ${existing.questarrGameId} on RomM platform ${existing.fsSlug}.`
    );
  }
  const entry: RegisteredGame = { ...input, createdAt: existing?.createdAt ?? new Date().toISOString() };
  if (existingIndex >= 0) state.games[existingIndex] = entry;
  else state.games.push(entry);
  await saveState(state);
  return entry;
}

function uniqueGames(games: JsonRecord[]) {
  const seen = new Set<string>();
  return games.filter((game) => {
    const id = scalarId(game.id) ?? scalarId(game.igdbId);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function summarizeCandidate(game: JsonRecord) {
  return {
    igdbId: numberValue(game.id) ?? numberValue(game.igdbId),
    title: gameTitle(game),
    platforms: gamePlatforms(game)
  };
}

function gameTitle(game: JsonRecord) {
  return text(game.title) ?? text(game.name);
}

function gamePlatforms(game: JsonRecord) {
  const platforms = game.platforms;
  return Array.isArray(platforms)
    ? platforms
        .map((item) => (typeof item === 'string' ? text(item) : text(record(item).name)))
        .filter((item): item is string => Boolean(item))
    : [];
}

function matchingPlatform(game: JsonRecord, requestedPlatform: string) {
  return gamePlatforms(game).find((platform) => normalized(platform) === normalized(requestedPlatform));
}

function normalized(value: string | undefined) {
  return value?.trim().toLocaleLowerCase() ?? '';
}

function boundedText(value: string, max: number, name: string) {
  const result = text(value);
  if (!result || result.length > max) throw new Error(`${name} must contain between 1 and ${max} characters.`);
  return result;
}

function statePath() {
  const env = readEnv();
  return path.join(env.STATE_ROOT ?? path.join(env.APP_ROOT ?? '.stackarr', 'state'), 'questarr-romm-import.json');
}

async function loadState(): Promise<ImportState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf8')) as Partial<ImportState>;
    return {
      version: 1,
      games: Array.isArray(parsed.games) ? parsed.games : [],
      imports: parsed.imports ?? {},
      pendingScanSlugs: Array.isArray(parsed.pendingScanSlugs)
        ? parsed.pendingScanSlugs.filter((slug): slug is string => typeof slug === 'string')
        : [],
      reconcileCursor: numberValue(parsed.reconcileCursor) ?? 0
    };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, games: [], imports: {}, pendingScanSlugs: [], reconcileCursor: 0 };
    }
    throw new Error('Questarr RomM import state is unreadable.');
  }
}

async function saveState(state: ImportState) {
  const target = statePath();
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, target);
}

function downloadsRoot() {
  const root = readEnv().QUESTARR_ROMM_DOWNLOAD_ROOT ?? '/downloads';
  return path.resolve(root);
}

function rommRomsRoot() {
  const root = readEnv().QUESTARR_ROMM_LIBRARY_ROOT ?? '/stackarr-romm-library';
  return path.resolve(root, 'roms');
}

async function completedDownloadPath(details: JsonRecord, root: string) {
  const downloadDir = text(details.downloadDir);
  const name = text(details.name);
  if (!downloadDir || !name) throw new Error('Questarr downloader details omitted downloadDir or name.');
  const files = records(details.files).filter((file) => file.wanted !== false);
  const onlyFile = files.length === 1 ? text(files[0]?.name) : undefined;
  const resolvedDir = path.resolve(downloadDir);
  const resolved =
    path.basename(resolvedDir) === name
      ? resolvedDir
      : onlyFile && path.basename(onlyFile) === name
        ? path.resolve(resolvedDir, onlyFile)
        : path.resolve(resolvedDir, name);
  const [realRoot, realResolved] = await Promise.all([realpath(root), realpath(resolved)]);
  if (realResolved !== realRoot && !realResolved.startsWith(`${realRoot}${path.sep}`)) {
    throw new Error('Questarr downloader path is outside the shared /downloads root.');
  }
  return realResolved;
}

async function safeRommDestination(fsSlug: string, title: string) {
  const root = await realpath(rommRomsRoot());
  const destination = path.resolve(root, fsSlug, title);
  if (!destination.startsWith(`${root}${path.sep}`)) throw new Error('RomM destination escaped the library root.');
  let current = root;
  for (const segment of path.relative(root, destination).split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('Symbolic links are not permitted in RomM imports.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
      throw error;
    }
  }
  return destination;
}

async function assertRommPlatform(fsSlug: string) {
  const response = record(await readNativeAppAction({ app: 'romm', operation: 'platforms', limit: 100 }));
  const result = response.result;
  const platforms = Array.isArray(result)
    ? records(result)
    : records(record(result).platforms ?? record(result).items ?? record(result).results);
  const match = platforms.find((platform) => text(platform.fs_slug) === fsSlug || text(platform.fsSlug) === fsSlug);
  if (!match) throw new Error(`RomM does not report a supported platform with fs_slug "${fsSlug}".`);
}

async function resolveRommPlatformSlug(platformName: string) {
  const response = record(await readNativeAppAction({ app: 'romm', operation: 'platforms', limit: 100 }));
  const result = response.result;
  const platforms = Array.isArray(result)
    ? records(result)
    : records(record(result).platforms ?? record(result).items ?? record(result).results);
  const wanted = normalized(platformName);
  const aliases: Record<string, string[]> = {
    'pc (microsoft windows)': ['windows', 'win'],
    'super famicom': ['super nintendo entertainment system', 'snes'],
    'playstation portable': ['psp'],
    'playstation vita': ['ps vita', 'psvita']
  };
  const candidates = new Set([wanted, ...(aliases[wanted] ?? [])].map(normalized));
  const matches = platforms.filter((platform) =>
    [
      text(platform.name),
      text(platform.display_name),
      text(platform.custom_name),
      text(platform.slug),
      text(platform.fs_slug)
    ]
      .filter((value): value is string => Boolean(value))
      .some((value) => candidates.has(normalized(value)))
  );
  const slugs = [
    ...new Set(matches.map((platform) => text(platform.fs_slug)).filter((value): value is string => Boolean(value)))
  ];
  if (slugs.length !== 1) {
    throw new Error(
      `Could not map IGDB platform "${platformName}" to exactly one RomM platform. Provide fsSlug explicitly.`
    );
  }
  return platformSlug(slugs[0]!);
}

async function validatedRommPlatformSlug(platformName: string, requestedFsSlug?: string) {
  if (!requestedFsSlug) return resolveRommPlatformSlug(platformName);
  const fsSlug = platformSlug(requestedFsSlug);
  await assertRommPlatform(fsSlug);
  let resolved: string | undefined;
  try {
    resolved = await resolveRommPlatformSlug(platformName);
  } catch {
    // Explicit selection is the safe escape hatch when platform aliases are ambiguous.
  }
  if (resolved && resolved !== fsSlug) {
    throw new Error(`RomM platform "${fsSlug}" does not match IGDB platform "${platformName}".`);
  }
  return fsSlug;
}

async function queueRommScan(platformFsSlugs: string[]) {
  try {
    const cookie = await rommSessionCookie();
    const baseUrl = serviceBaseUrl('romm');
    await new Promise<void>((resolve, reject) => {
      const socket = io(baseUrl, {
        path: '/ws/socket.io/',
        transports: ['websocket', 'polling'],
        extraHeaders: { Cookie: cookie },
        timeout: 15_000
      });
      const timer = setTimeout(() => {
        socket.disconnect();
        reject(new Error('RomM Socket.IO scan acknowledgement timed out.'));
      }, 15_000);
      socket.once('connect_error', () => {
        clearTimeout(timer);
        socket.disconnect();
        reject(new Error('RomM Socket.IO scan connection was rejected.'));
      });
      socket.once('connect', () => {
        socket.once('scan:done_ko', (message) => {
          clearTimeout(timer);
          socket.disconnect();
          reject(
            new Error(`RomM rejected the targeted scan: ${typeof message === 'string' ? message : 'unknown reason'}`)
          );
        });
        socket.timeout(10_000).emit(
          'scan',
          {
            platform_fs_slugs: platformFsSlugs,
            type: 'quick',
            apis: [],
            launchbox_remote_enabled: true,
            playmatch_enabled: true
          },
          (error: Error | null) => {
            clearTimeout(timer);
            socket.disconnect();
            if (error) reject(new Error('RomM did not acknowledge the targeted scan request.'));
            else resolve();
          }
        );
      });
    });
    return { queued: true, verified: true, platformFsSlugs };
  } catch (error) {
    return {
      queued: false,
      verified: false,
      platformFsSlugs,
      reason: error instanceof Error ? error.message : 'RomM targeted scan could not be queued.'
    };
  }
}

async function listRommLibraryRecords() {
  const cookie = await rommSessionCookie();
  const results: JsonRecord[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  const maximumRecords = 5000;
  while (offset < total) {
    const response = await fetch(
      withQuery(`${serviceBaseUrl('romm')}/api/roms`, {
        limit: 200,
        offset,
        with_char_index: false,
        with_filter_values: false,
        with_rom_id_index: false
      }),
      { headers: { cookie }, signal: AbortSignal.timeout(30_000) }
    );
    if (!response.ok) throw new Error(`RomM library request failed with HTTP ${response.status}.`);
    const page = record(await response.json());
    const items = records(page.items);
    results.push(...items);
    total = numberValue(page.total) ?? results.length;
    if (total > maximumRecords && results.length >= maximumRecords) {
      throw new Error(`RomM library exceeds the bounded ${maximumRecords}-record synchronization read limit.`);
    }
    if (items.length === 0) break;
    offset += items.length;
  }
  return results;
}

async function filesystemPresentRoms(roms: JsonRecord[]) {
  const root = path.resolve(readEnv().QUESTARR_ROMM_LIBRARY_ROOT ?? '/stackarr-romm-library');
  const present: JsonRecord[] = [];
  for (let offset = 0; offset < roms.length; offset += 32) {
    const checks = await Promise.all(
      roms.slice(offset, offset + 32).map(async (rom) => {
        const fullPath = text(rom.full_path);
        const fsPath = text(rom.fs_path);
        const fsName = text(rom.fs_name);
        const relativePath = fullPath ?? (fsPath && fsName ? path.join(fsPath, fsName) : undefined);
        if (!relativePath || path.isAbsolute(relativePath)) return false;
        const candidate = path.resolve(root, relativePath);
        if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return false;
        try {
          await stat(candidate);
          return true;
        } catch {
          return false;
        }
      })
    );
    for (let index = 0; index < checks.length; index += 1) {
      if (checks[index]) present.push(roms[offset + index]!);
    }
  }
  return present;
}

async function rommSessionCookie() {
  const env = readEnv();
  const username = env.ROMM_ADMIN_USERNAME?.trim() || env.USERNAME?.trim();
  const password = env.ROMM_ADMIN_PASSWORD?.trim() || env.PASSWORD?.trim();
  if (!username || !password)
    throw new Error('RomM targeted scan requires Stackarr USERNAME and PASSWORD runtime credentials.');
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  const response = await fetch(`${serviceBaseUrl('romm')}/api/login`, {
    method: 'POST',
    headers: { authorization },
    signal: AbortSignal.timeout(15_000)
  });
  const cookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
  const session = cookies.find((cookie) => cookie.startsWith('romm_session='));
  if (!response.ok || !session) throw new Error('RomM login did not return a romm_session cookie.');
  return session.split(';', 1)[0]!;
}

async function clamdScan(source: string) {
  const env = readEnv();
  if (env.QUESTARR_ROMM_CLAMAV_ENABLED === 'false') throw new Error('Secure import requires ClamAV.');
  const host = env.QUESTARR_ROMM_CLAMAV_HOST?.trim() || 'clamav';
  const rawPort = env.QUESTARR_ROMM_CLAMAV_PORT?.trim() || '3310';
  if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) > 65535) throw new Error('QUESTARR_ROMM_CLAMAV_PORT is invalid.');
  const command = `zCONTSCAN ${source.replace(/\n/g, '')}\0`;
  const response = await new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host, port: Number(rawPort) });
    let output = '';
    socket.setTimeout(30_000);
    socket.once('error', () => reject(new Error('ClamAV is unavailable; import failed closed.')));
    socket.once('timeout', () => {
      socket.destroy();
      reject(new Error('ClamAV timed out; import failed closed.'));
    });
    socket.on('data', (chunk) => {
      output += chunk.toString('utf8');
    });
    socket.once('connect', () => socket.write(command));
    socket.once('end', () => resolve(output));
  });
  if (!response.includes('OK') || response.includes('FOUND') || /ERROR/i.test(response)) {
    throw new Error('ClamAV rejected the download; import failed closed.');
  }
}

async function importTree(source: string, destination: string, mode: ImportMode): Promise<number> {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new Error('Symbolic links are not permitted in Questarr imports.');
  if (info.isDirectory()) {
    let count = 0;
    for (const entry of await readdir(source))
      count += await importTree(path.join(source, entry), path.join(destination, entry), mode);
    return count;
  }
  if (!info.isFile()) return 0;
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await stat(destination);
    return 0;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (mode === 'hardlink') await link(source, destination);
  else await copyFile(source, destination);
  return 1;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};
}
function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonRecord => Boolean(item) && typeof item === 'object')
    : [];
}
function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
function scalarId(value: unknown) {
  return text(value) ?? (typeof value === 'number' && Number.isFinite(value) ? String(value) : undefined);
}
function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value < 1 || value > 2_147_483_647)
    throw new Error(`${name} must be a positive integer.`);
  return value;
}
function boundedInteger(value: number, min: number, max: number, name: string) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}
function numberFromText(value: string | undefined) {
  return value && /^\d+$/.test(value) ? Number(value) : undefined;
}
function numberValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return undefined;
}
function importMode(value: string | undefined): ImportMode {
  if (!value) return 'hardlink';
  if (value === 'hardlink' || value === 'copy') return value;
  throw new Error('QUESTARR_ROMM_TRANSFER_MODE must be hardlink or copy.');
}
function platformSlug(value: string) {
  const slug = text(value);
  if (!slug || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug))
    throw new Error('fsSlug must contain 1 to 64 lowercase letters, digits, underscores, or hyphens.');
  return slug;
}
function sanitizeTitle(value: string) {
  const result = value
    .normalize('NFKD')
    .replace(/[^\w .-]+/g, '')
    .replace(/[. ]+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!result || result === '.' || result === '..')
    throw new Error('Game title cannot be used as a safe RomM folder name.');
  return result;
}
function firstPlatform(game: JsonRecord) {
  const platforms = game.platforms;
  return Array.isArray(platforms)
    ? platforms
        .map((item) => (typeof item === 'string' ? item : text(record(item).name)))
        .find((item): item is string => Boolean(item))
    : undefined;
}

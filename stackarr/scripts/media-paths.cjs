#!/usr/bin/env node
// One path contract for generated mounts and application configurators.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function absolute(value, name) {
  if (!value || !path.posix.isAbsolute(value) || /[\x00-\x1f:]/.test(value) || value.split('/').includes('..'))
    throw new Error(`${name} must be an absolute host folder without traversal or control characters`);
  return path.posix.normalize(value).replace(/\/$/, '') || '/';
}
function within(root, target) {
  return target === root || target.startsWith(`${root}/`);
}
function resolvePaths(env) {
  const layout = env.MEDIA_PATH_LAYOUT || 'legacy';
  if (!['legacy', 'shared'].includes(layout)) throw new Error('Unknown media path layout');
  const legacy = {
    CONTAINER_MEDIA_ROOT: '/media',
    CONTAINER_MOVIES_ROOT: '/movies',
    CONTAINER_TV_ROOT: '/tv',
    CONTAINER_DOWNLOADS_ROOT: '/downloads',
    CONTAINER_TORRENT_ARCHIVE_ROOT: '/torrent-archive',
    CONTAINER_TDARR_MEDIA_ROOT: '/media',
    CONTAINER_TDARR_CACHE_ROOT: '/temp'
  };
  if (layout === 'legacy') return { layout, paths: legacy, bindings: {} };
  const root = absolute(env.MEDIA_ROOT, 'Media location');
  if (root === '/') throw new Error('Select a Media folder, not the filesystem root');
  const bindings = {};
  const resolve = (key, host, external) => {
    const source = absolute(host, key);
    const child = within(root, source);
    const target = child ? `/data${source.slice(root.length)}` : `/external/${external}`;
    bindings[key] = { source: child ? root : source, target: child ? '/data' : target };
    return target;
  };
  const paths = {
    CONTAINER_MEDIA_ROOT: '/data',
    CONTAINER_MOVIES_ROOT: '/data/Movies',
    CONTAINER_TV_ROOT: '/data/TV Shows',
    CONTAINER_DOWNLOADS_ROOT: resolve('downloads', env.DOWNLOADS_ROOT || `${root}/Downloads`, 'downloads'),
    CONTAINER_TORRENT_ARCHIVE_ROOT: resolve(
      'archive',
      env.TORRENT_ARCHIVE_ROOT || `${env.STATE_ROOT}/torrent-archive`,
      'torrent-archive'
    ),
    CONTAINER_TDARR_MEDIA_ROOT: resolve('tdarrMedia', env.TDARR_MEDIA_ROOT || root, 'tdarr-media'),
    CONTAINER_TDARR_CACHE_ROOT: resolve(
      'tdarrCache',
      env.TDARR_CACHE_ROOT || `${root}/Downloads/transcodes`,
      'tdarr-cache'
    )
  };
  bindings.media = { source: root, target: '/data' };
  bindings.downloadsOnly = {
    source: absolute(env.DOWNLOADS_ROOT || `${root}/Downloads`, 'Downloads folder'),
    target: paths.CONTAINER_DOWNLOADS_ROOT
  };
  // Placeholder management needs libraries, not downloader or scratch access.
  bindings.moviesLibrary = { source: `${root}/Movies`, target: '/data/Movies' };
  bindings.tvLibrary = { source: `${root}/TV Shows`, target: '/data/TV Shows' };
  return { layout, paths, bindings };
}
// Restrict the transform to the managed import pipeline. Apps reserving /data
// for their own configuration (e.g. tinyMediaManager) keep their native layout.
const targets = {
  transmission: { '/downloads': 'downloadsOnly' },
  qbittorrent: { '/downloads': 'downloadsOnly' },
  radarr: { '/movies': 'media', '/downloads': 'downloads', '/torrent-archive': 'archive' },
  radarr4k: { '/movies': 'media', '/downloads': 'downloads', '/torrent-archive': 'archive' },
  sonarr: { '/tv': 'media', '/downloads': 'downloads', '/torrent-archive': 'archive' },
  sonarr4k: { '/tv': 'media', '/downloads': 'downloads', '/torrent-archive': 'archive' },
  bazarr: { '/movies': 'moviesLibrary', '/tv': 'tvLibrary' },
  agregarr: { '/movies': 'moviesLibrary', '/tv': 'tvLibrary' },
  tdarr: { '/media': 'tdarrMedia', '/temp': 'tdarrCache' },
  lidarr: { '/downloads': 'downloadsOnly' },
  questarr: { '/downloads': 'downloadsOnly' }
};
function composeSource(text, env) {
  const resolved = resolvePaths(env);
  if (resolved.layout === 'legacy') return text;
  let service = '',
    inVolumes = false,
    seen = new Set();
  return text
    .split('\n')
    .flatMap((line) => {
      const header = line.match(/^  ([a-zA-Z0-9_-]+):\s*$/);
      if (header) {
        service = header[1];
        seen = new Set();
        inVolumes = false;
      }
      if (/^    \w/.test(line)) inVolumes = /^    volumes:/.test(line);
      if (!inVolumes || !targets[service]) return [line];
      const mount = line.match(/^      - ".*:(\/[^":]+)(:ro|:rw)?"\s*$/);
      if (!mount || !targets[service][mount[1]]) return [line];
      const bind = resolved.bindings[targets[service][mount[1]]];
      const mode = mount[2] || '';
      const key = `${bind.source}:${bind.target}${mode}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [`      - ${JSON.stringify(key.replaceAll('$', () => '$$'))}`];
    })
    .join('\n');
}
function fingerprint(env) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(resolvePaths(env)))
    .digest('hex');
}
function containsState(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .some((entry) => !entry.isDirectory() || containsState(path.join(dir, entry.name)));
}
function assertReady(env) {
  if ((env.MEDIA_PATH_LAYOUT || 'legacy') === 'legacy') return;
  const receipt = path.join(absolute(env.STATE_ROOT, 'State folder'), 'media-path-layout.json');
  if (fs.existsSync(receipt)) {
    const data = JSON.parse(fs.readFileSync(receipt, 'utf8'));
    if (data.layout === 'shared' && data.fingerprint === fingerprint(env)) return;
    throw new Error('Media paths changed after activation. Migrate application paths before applying mounts.');
  }
  // Never hide legacy application paths on upgrade. An explicit migration writes
  // the receipt only after native path-only APIs and identity checks succeed.
  const configRoot = absolute(env.CONFIG_ROOT, 'App data folder');
  const appRoot = env.APP_ROOT ? absolute(env.APP_ROOT, 'Application folder') : null;
  for (const app of Object.keys(targets)) {
    const candidates = [path.join(configRoot, app)];
    // These two services use APP_ROOT/config rather than CONFIG_ROOT in Compose.
    if (appRoot && (app === 'bazarr' || app === 'agregarr')) candidates.push(path.join(appRoot, 'config', app));
    if (app === 'questarr' && env.QUESTARR_DATA_ROOT)
      candidates.push(absolute(env.QUESTARR_DATA_ROOT, 'Questarr data folder'));
    for (const dir of candidates) {
      if (fs.existsSync(dir) && containsState(dir))
        throw new Error(`Existing ${app} configuration needs a verified media path migration before shared mounts`);
    }
  }
}
function recordReady(env) {
  const file = path.join(env.STATE_ROOT, 'media-path-layout.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify({ layout: 'shared', fingerprint: fingerprint(env) })}\n`, {
    mode: 0o600,
    flag: 'wx'
  });
  fs.renameSync(temp, file);
}
module.exports = { resolvePaths, composeSource, fingerprint, assertReady, recordReady };
if (require.main === module) {
  try {
    const command = process.argv[2];
    if (command === 'exports') {
      for (const [key, value] of Object.entries(resolvePaths(process.env).paths))
        console.log(`export ${key}='${value.replaceAll("'", "'\\''")}'`);
    } else if (command === 'compose') {
      const file = process.argv[3];
      fs.writeFileSync(file, composeSource(fs.readFileSync(file, 'utf8'), process.env));
    } else if (command === 'check') assertReady(process.env);
    else if (command === 'activate-new') {
      assertReady(process.env);
      if (process.env.MEDIA_PATH_LAYOUT === 'shared') recordReady(process.env);
    } else throw new Error('Expected exports, compose, check or activate-new');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

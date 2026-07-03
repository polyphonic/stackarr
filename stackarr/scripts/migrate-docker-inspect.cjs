#!/usr/bin/env node
const chunks = [];

process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))[0];
  const name = String(data.Name || '').replace(/^\//, '');
  const image = String(data.Config?.Image || '');
  const labels = data.Config?.Labels || {};

  if (labels['com.docker.compose.project'] === 'stackarr') {
    process.exit(2);
  }

  const service = serviceName(`${name} ${image}`.toLowerCase().replace(/[_.]/g, '-'));
  if (!service) {
    process.exit(1);
  }

  const preferred = {
    seerr: ['/app/config', '/config'],
    pulsarr: ['/app/data', '/config'],
    maintainerr: ['/opt/data'],
    tinymediamanager: ['/data', '/config'],
    tidarr: ['/shared', '/config'],
    bookorbit: ['/data', '/config']
  };
  const destinations = preferred[service] || ['/config', '/app/config', '/app/data', '/data', '/shared'];
  const mounts = data.Mounts || [];

  for (const desired of destinations) {
    const mount = mounts.find((item) => item.Destination === desired);
    if (mount) {
      console.log(`${service}|${desired}`);
      return;
    }
  }

  const fallback = mounts.find(
    (item) => destinations.includes(item.Destination) || item.Destination?.endsWith('/config')
  );
  if (fallback) {
    console.log(`${service}|${fallback.Destination}`);
    return;
  }

  process.exit(1);
});

function serviceName(value) {
  const checks = [
    ['radarr4k', ['radarr4k', 'radarr-4k', 'radarr-uhd', 'radarr-ultra']],
    ['sonarr4k', ['sonarr4k', 'sonarr-4k', 'sonarr-uhd', 'sonarr-ultra']],
    ['prowlarr', ['prowlarr']],
    ['radarr', ['radarr']],
    ['sonarr', ['sonarr']],
    ['lidarr', ['lidarr']],
    ['bazarr', ['bazarr']],
    ['seerr', ['jellyseerr', 'overseerr', 'seerr']],
    ['pulsarr', ['pulsarr']],
    ['maintainerr', ['maintainerr']],
    ['transmission', ['transmission']],
    ['qbittorrent', ['qbittorrent', 'qbit']],
    ['tinymediamanager', ['tiny-media-manager', 'tinymediamanager', 'tinymm']],
    ['recyclarr', ['recyclarr']],
    ['flaresolverr', ['flaresolverr']],
    ['tidarr', ['tidarr']],
    ['bookorbit', ['bookorbit']],
    ['plex', ['plex']],
    ['jellyfin', ['jellyfin']]
  ];

  for (const [service, needles] of checks) {
    if (needles.some((needle) => value.includes(needle))) {
      return service;
    }
  }

  return '';
}

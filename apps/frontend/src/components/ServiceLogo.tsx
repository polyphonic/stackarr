import styles from './ServiceLogo.module.css';

const logoPaths: Record<string, string> = {
  app: '/icon.svg',
  stackarr: '/icon.svg',
  database: '/logos/postgres.svg',
  postgres: '/logos/postgres.svg',
  redis: '/logos/redis.svg',
  sonarr: '/logos/sonarr.svg',
  sonarr4k: '/logos/sonarr.svg',
  radarr: '/logos/radarr.svg',
  radarr4k: '/logos/radarr.svg',
  lidarr: '/logos/lidarr.svg',
  prowlarr: '/logos/prowlarr.svg',
  bazarr: '/logos/bazarr.svg',
  plex: '/logos/plex.svg',
  jellyfin: '/logos/jellyfin.svg',
  qbittorrent: '/logos/qbittorrent.svg',
  transmission: '/logos/transmission.svg',
  cloudflare: '/logos/cloudflare.svg',
  seerr: '/logos/overseerr.svg',
  pulsarr: '/logos/pulsarr.svg',
  maintainerr: '/logos/maintainerr.svg',
  agregarr: '/logos/agregarr.svg',
  tracearr: '/logos/tracearr.svg',
  bookorbit: '/logos/bookorbit.svg',
  immich: '/logos/immich.svg',
  'immich-ml': '/logos/immich.svg',
  'immich-machine-learning': '/logos/immich.svg',
  immich_machine_learning: '/logos/immich.svg',
  romm: '/logos/romm.svg',
  overseerr: '/logos/overseerr.svg',
  recyclarr: '/logos/recyclarr.svg',
  flaresolverr: '/logos/flaresolverr.svg',
  tidarr: '/logos/tidal.svg',
  streamrip: '/logos/tidal.svg',
  docker: '/logos/docker.svg',
  tinymediamanager: '/logos/tinymediamanager.svg',
  tmm: '/logos/tinymediamanager.svg',
  webhook: '/icon.svg'
};

export function ServiceLogo({ name, size = 34 }: { name: string; size?: number }) {
  const src = logoPaths[name.toLowerCase()];
  const label = name.replace(/4k/i, ' 4K');

  if (!src) {
    return (
      <span className={styles.fallback} style={{ width: size, height: size }}>
        {label.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <span className={styles.logo} style={{ width: size, height: size }}>
      <img alt={`${label} logo`} src={src} />
    </span>
  );
}

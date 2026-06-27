export type ServiceIntegration = {
  category: string;
  hero: string;
  logo: string;
  name: string;
  role: string;
  slug: string;
  stackarr: string;
  whatItDoes: string[];
};

export const serviceIntegrations = [
  {
    slug: 'sonarr',
    name: 'Sonarr',
    logo: 'sonarr',
    category: 'TV automation',
    role: 'Series library manager',
    hero: 'Sonarr tracks TV series, monitors wanted episodes, and sends matched releases to your downloader.',
    whatItDoes: [
      'Keeps episode libraries organized around series, seasons, and quality profiles.',
      'Works with indexers through Prowlarr and download clients such as qBittorrent or Transmission.',
      'Renames and moves completed episodes into the library structure your media server expects.'
    ],
    stackarr:
      'Stackarr treats Sonarr as a first-class TV service: setup can wire indexers, download clients, naming presets, request routing, health checks, backups, and direct service links from one control plane.'
  },
  {
    slug: 'radarr',
    name: 'Radarr',
    logo: 'radarr',
    category: 'Movie automation',
    role: 'Movie library manager',
    hero: 'Radarr monitors movies, applies quality rules, and coordinates downloads for a clean film library.',
    whatItDoes: [
      'Tracks wanted movies and upgrades existing files when better releases match your profile.',
      'Connects to indexers and download clients without making the media server do acquisition work.',
      'Organizes completed movies into predictable folders and filenames.'
    ],
    stackarr:
      'Stackarr uses Radarr as the movie automation layer and can apply shared download, naming, Recyclarr, Seerr, backup, and service-link settings without making you jump between apps.'
  },
  {
    slug: 'lidarr',
    name: 'Lidarr',
    logo: 'lidarr',
    category: 'Music automation',
    role: 'Music library manager',
    hero: 'Lidarr brings the arr workflow to music libraries with artist monitoring and release management.',
    whatItDoes: [
      'Tracks artists and albums against quality profiles.',
      'Sends matched releases to a downloader and imports completed albums.',
      'Keeps music files organized for Plex, Jellyfin, or another library scanner.'
    ],
    stackarr:
      'Stackarr can enable Lidarr alongside movies, TV, and books, then keep its links, credentials, download routing, backups, and companion music workflow settings in the same setup flow.'
  },
  {
    slug: 'prowlarr',
    name: 'Prowlarr',
    logo: 'prowlarr',
    category: 'Indexer management',
    role: 'Indexer hub',
    hero: 'Prowlarr centralizes indexers and syncs them into the arr apps that need search access.',
    whatItDoes: [
      'Manages indexer definitions, tags, categories, and application sync from one place.',
      'Feeds Sonarr, Radarr, Lidarr, and related apps with consistent indexer settings.',
      'Can use helpers such as FlareSolverr for indexers that need browser-style challenge handling.'
    ],
    stackarr:
      'Stackarr uses Prowlarr as the indexer backbone and can apply application links, seed defaults, FlareSolverr tags, health checks, and backups as part of the same managed stack.'
  },
  {
    slug: 'bazarr',
    name: 'Bazarr',
    logo: 'bazarr',
    category: 'Subtitles',
    role: 'Subtitle manager',
    hero: 'Bazarr searches for subtitles that match the movies and episodes managed by your arr apps.',
    whatItDoes: [
      'Monitors movie and TV libraries for missing or upgradeable subtitles.',
      'Coordinates with Sonarr and Radarr so subtitles follow the same media inventory.',
      'Stores subtitle preferences separately from the media server itself.'
    ],
    stackarr:
      'Stackarr can include Bazarr in the guided setup, expose it in the service map, and protect its configuration in backups so subtitle automation stays recoverable.'
  },
  {
    slug: 'seerr',
    name: 'Seerr',
    logo: 'overseerr',
    category: 'Requests',
    role: 'Request portal',
    hero: 'Seerr gives users a request interface for movies and shows without giving them direct arr app access.',
    whatItDoes: [
      'Accepts media requests through a friendly portal-style interface.',
      'Routes approved movie and TV requests into Radarr and Sonarr.',
      'Works well when you want a request layer for Jellyfin, Plex, or mixed media-server setups.'
    ],
    stackarr:
      'Stackarr can enable Seerr, apply request presets, wire Radarr and Sonarr targets, manage public-access choices, and surface request tools through the dashboard and agent interface.'
  },
  {
    slug: 'jellyfin',
    name: 'Jellyfin',
    logo: 'jellyfin',
    category: 'Media server',
    role: 'Open-source streaming server',
    hero: 'Jellyfin serves your movies, shows, music, and other media from your own hardware.',
    whatItDoes: [
      'Scans organized media folders and makes them available through web, mobile, and TV clients.',
      'Keeps playback and library access under your control.',
      'Can run beside arr automation while remaining separate from download and request workflows.'
    ],
    stackarr:
      'Stackarr supports Jellyfin as a media-server target while leaving ownership clear: it can track service state, link users to the app, and keep the surrounding acquisition, request, and backup workflows together.'
  },
  {
    slug: 'docker',
    name: 'Docker',
    logo: 'docker',
    category: 'Runtime',
    role: 'Container runtime',
    hero: 'Docker runs the managed service stack with repeatable images, networks, volumes, and profiles.',
    whatItDoes: [
      'Keeps each service isolated while letting the stack communicate over a private network.',
      'Makes updates and rollbacks more predictable than hand-installed service sprawl.',
      'Provides a common runtime across Docker-compatible hosts.'
    ],
    stackarr:
      'Stackarr wraps Docker Compose with setup profiles, service health, update tasks, backup exclusions, and safe operational commands so the container stack is easier to understand and recover.'
  },
  {
    slug: 'qbittorrent',
    name: 'qBittorrent',
    logo: 'qbittorrent',
    category: 'Downloads',
    role: 'Torrent client',
    hero: 'qBittorrent handles torrent downloads for the arr apps and stores completed files for import.',
    whatItDoes: [
      'Receives download jobs from Sonarr, Radarr, Lidarr, and related tools.',
      'Separates incomplete and completed downloads for cleaner imports.',
      'Provides a full-featured web UI for queue and transfer management.'
    ],
    stackarr:
      'Stackarr can configure qBittorrent as a shared download target, keep its service link visible, and include the durable client settings in the backup model.'
  },
  {
    slug: 'transmission',
    name: 'Transmission',
    logo: 'transmission',
    category: 'Downloads',
    role: 'Torrent client',
    hero: 'Transmission is a lightweight torrent client that pairs cleanly with arr-style automation.',
    whatItDoes: [
      'Accepts download jobs through its RPC interface.',
      'Keeps a small operational footprint for simple home-server setups.',
      'Works with completed-download folders that arr apps can import from.'
    ],
    stackarr:
      'Stackarr can use Transmission as the torrent backend, apply consistent folder conventions, expose the web UI, and include its recoverable configuration in backups.'
  },
  {
    slug: 'plex',
    name: 'Plex',
    logo: 'plex',
    category: 'Media server',
    role: 'Streaming media server',
    hero: 'Plex turns organized media folders into polished libraries for your devices and users.',
    whatItDoes: [
      'Scans movies, shows, music, and libraries into a client-friendly catalog.',
      'Handles playback, metadata presentation, and remote-client access patterns.',
      'Can run natively or near a Docker-managed automation stack.'
    ],
    stackarr:
      'Stackarr is designed around practical Plex installs: it can support native media-server paths, direct service links, Plex-aware backup modes, request workflows, and the automation services around the library.'
  },
  {
    slug: 'pulsarr',
    name: 'Pulsarr',
    logo: 'pulsarr',
    category: 'Requests',
    role: 'Plex watchlist automation',
    hero: 'Pulsarr turns Plex watchlist activity into actionable media requests for the arr stack.',
    whatItDoes: [
      'Watches selected Plex users or watchlists for wanted media.',
      'Routes matching movie and TV intent toward Radarr and Sonarr.',
      'Reduces the need for users to learn the automation tools directly.'
    ],
    stackarr:
      'Stackarr makes Pulsarr the default request-manager path for Plex-oriented setups, including first-run credentials, database choices, service links, backups, and optional Cloudflare routing.'
  },
  {
    slug: 'bookorbit',
    name: 'BookOrbit',
    logo: 'bookorbit',
    category: 'Books',
    role: 'Book request and library app',
    hero: 'BookOrbit adds a book-focused service to the same private media stack pattern.',
    whatItDoes: [
      'Provides a dedicated surface for book discovery, requests, and app state.',
      'Uses Postgres-backed storage for durable book workflow data.',
      'Complements movie, TV, music, and request services in one home-server stack.'
    ],
    stackarr:
      'Stackarr can enable BookOrbit, create its database, apply bootstrap credentials, expose the service link, and include the right durable state in backups.'
  },
  {
    slug: 'tinymediamanager',
    name: 'TinyMediaManager',
    logo: 'tinymediamanager',
    category: 'Metadata',
    role: 'Metadata and naming tool',
    hero: 'TinyMediaManager helps prepare local metadata, artwork, and naming for media libraries.',
    whatItDoes: [
      'Manages local metadata files and artwork for movies and shows.',
      'Supports consistent naming decisions outside the media-server scanner.',
      'Helps keep libraries portable when metadata should live beside the files.'
    ],
    stackarr:
      'Stackarr can include TinyMediaManager in setup, apply naming presets, link the service, and back up durable metadata databases while skipping rebuildable caches and add-ons.'
  },
  {
    slug: 'recyclarr',
    name: 'Recyclarr',
    logo: 'recyclarr',
    category: 'Quality profiles',
    role: 'TRaSH guide sync',
    hero: 'Recyclarr syncs curated quality profiles, custom formats, and naming guidance into arr apps.',
    whatItDoes: [
      'Applies reusable profile configuration to Sonarr and Radarr.',
      'Keeps quality rules consistent across HD and 4K service profiles.',
      'Separates profile sync from daily media requests and downloads.'
    ],
    stackarr:
      'Stackarr can generate Recyclarr config, wire app API keys, run sync tasks, and keep profile choices visible alongside the rest of setup.'
  },
  {
    slug: 'flaresolverr',
    name: 'FlareSolverr',
    logo: 'flaresolverr',
    category: 'Indexer support',
    role: 'Challenge solver proxy',
    hero: 'FlareSolverr helps indexers that require browser-like challenge handling before search can continue.',
    whatItDoes: [
      'Runs as a proxy endpoint for compatible indexer integrations.',
      'Lets Prowlarr tag selected indexers with a solver route.',
      'Keeps challenge handling separate from the arr apps themselves.'
    ],
    stackarr:
      'Stackarr can enable FlareSolverr, link it into Prowlarr proxy settings, show its service state, and preserve the operational choice in configuration.'
  },
  {
    slug: 'postgres',
    name: 'Postgres',
    logo: 'postgres',
    category: 'Database',
    role: 'Shared application database',
    hero: 'Postgres provides durable relational storage for services that need more than local SQLite files.',
    whatItDoes: [
      'Stores application data for services that support or require Postgres.',
      'Keeps database users and app databases separated by service.',
      'Supports extensions needed by services such as BookOrbit.'
    ],
    stackarr:
      'Stackarr can create service databases, keep app-default mode lightweight, switch to shared Postgres where useful, and include database dumps in recoverable backups.'
  },
  {
    slug: 'cloudflare',
    name: 'Cloudflare',
    logo: 'cloudflare',
    category: 'Remote access',
    role: 'Tunnel and access routing',
    hero: 'Cloudflare can expose selected Stackarr-managed services without opening every local app directly.',
    whatItDoes: [
      'Maps public hostnames to chosen internal services through a tunnel.',
      'Lets you decide which apps should be reachable beyond the local network.',
      'Can add an additional access policy in front of sensitive service routes.'
    ],
    stackarr:
      'Stackarr keeps Cloudflare routing explicit: setup and settings map hostnames to services such as Pulsarr or BookOrbit, and agent tools can inspect or update routes with clear confirmation.'
  }
] satisfies ServiceIntegration[];

export const serviceIntegrationMap = new Map(serviceIntegrations.map((service) => [service.slug, service]));

export function getServiceIntegration(slug: string) {
  return serviceIntegrationMap.get(slug);
}

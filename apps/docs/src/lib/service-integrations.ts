export type ServiceIntegration = {
  category: string;
  hero: string;
  logo: string;
  logoExtension?: 'png' | 'svg';
  name: string;
  role: string;
  slug: string;
  stackarr: string;
  whatItDoes: string[];
};

const serviceIntegrationDefinitions = [
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
    slug: 'tidarr',
    name: 'Tidarr',
    logo: 'tidal',
    category: 'Music acquisition',
    role: 'Tidal download companion',
    hero: 'Tidarr adds a Tidal-oriented acquisition path beside Lidarr for music that needs a dedicated downloader.',
    whatItDoes: [
      'Provides a focused download surface for Tidal music workflows.',
      'Keeps its queue and credentials separate from the general torrent client.',
      'Can hand completed music into the library layout managed around Lidarr.'
    ],
    stackarr:
      'Stackarr can run Tidarr, expose its service link, preserve its configuration, and surface safe status and download actions. Tidal sign-in and the final Lidarr download-client connection remain explicit user steps.'
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
      'Stackarr is designed around practical Plex installs: it can support native media-server paths, direct service links, Plex-aware backup modes, request workflows, and the automation services around the library. The Home performance charts use Plex resource history directly when it is available.'
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
      'Stackarr makes Pulsarr the default request-manager path for Plex-oriented setups, including first-run credentials, a dedicated agent API key, Plex and Arr wiring, database choices, service links, backups, and optional Cloudflare routing.'
  },
  {
    slug: 'maintainerr',
    name: 'Maintainerr',
    logo: 'maintainerr',
    category: 'Cleanup',
    role: 'Library cleanup planner',
    hero: 'Maintainerr creates Plex or Jellyfin cleanup collections from rules that you review before removal.',
    whatItDoes: [
      'Connects to a media server and related request or arr services for cleanup context.',
      'Builds collections from rule conditions such as activity, requests, or library state.',
      'Can remove media after rules and collection timing are deliberately configured in its UI.'
    ],
    stackarr:
      'Stackarr can run Maintainerr, persist its data, link it through localhost or Portless, include it in backups, and wire Plex/Jellyfin, Radarr/Sonarr, Seerr, and qBittorrent when available while leaving destructive cleanup rules user-controlled.'
  },
  {
    slug: 'cleanuparr',
    name: 'Cleanuparr',
    logo: 'cleanuparr',
    category: 'Download security',
    role: 'Download malware blocker',
    hero: 'Cleanuparr monitors download clients and Arr applications for unwanted or unsafe files.',
    whatItDoes: [
      'Connects to supported download clients and Arr applications.',
      'Blocks executable, script, shortcut, installer, and disk-image patterns before import.',
      'Keeps malware checks separate from ordinary media-library automation.'
    ],
    stackarr:
      'Stackarr can run Cleanuparr privately, connect the selected torrent client and enabled Arr apps, install a media-safe executable blocklist, surface its service link, and include its durable configuration in backups.'
  },
  {
    slug: 'agregarr',
    name: 'Agregarr',
    logo: 'agregarr',
    category: 'Collections',
    role: 'Plex collection curator',
    hero: 'Agregarr builds and schedules Plex collections from your libraries, Arr monitoring state, and discovery sources.',
    whatItDoes: [
      'Creates managed Plex collections from sources such as Coming Soon, TMDb, and IMDb.',
      "Promotes collections onto Plex Home and each library's Recommended screen while preserving handmade collections as pre-existing.",
      'Keeps linked movie and TV collection rows synchronized on a schedule.'
    ],
    stackarr:
      "Stackarr initializes Agregarr through its native API with the signed-in Plex owner token, connects Radarr and Sonarr, saves the generated API key, and creates linked Coming Soon rows as the default source ordered by release availability. Trusted CLI and MCP commands expose common presets, Home and Discover visibility, shuffle, and targeted sync without duplicating Agregarr's editor in the Stackarr dashboard."
  },
  {
    slug: 'tracearr',
    name: 'Tracearr',
    logo: 'tracearr',
    category: 'Monitoring',
    role: 'Media-server analytics',
    hero: 'Tracearr monitors Plex, Jellyfin, and Emby sessions in real time with analytics and detection rules.',
    whatItDoes: [
      'Tracks active streams, watch history, bandwidth, devices, and playback locations across media servers.',
      'Uses the shared Postgres service with TimescaleDB plus shared Redis for analytics, rules, and real-time updates.',
      'Can import legacy watch-history data while keeping future monitoring in one self-hosted dashboard.'
    ],
    stackarr:
      'Stackarr can start Tracearr against the shared Postgres/TimescaleDB and Redis services, persist built-in backups under the Stackarr config root, expose localhost/Portless links, wire the first owner plus media server, and connect a read-only public API token for chat and dashboard insights.'
  },
  {
    slug: 'immich',
    name: 'Immich',
    logo: 'immich',
    category: 'Photos',
    role: 'Photo and video backup app',
    hero: 'Immich brings self-hosted photo and video backup, browsing, and mobile sync into the Stackarr service model.',
    whatItDoes: [
      'Backs up camera-roll photos and videos from iOS and Android clients.',
      'Provides a fast private photo library with albums, people, search, and sharing workflows.',
      'Runs a dedicated server and machine-learning worker while using Stackarr shared Redis and Postgres with pgvector.'
    ],
    stackarr:
      'Stackarr can enable Immich as optional photo-library functionality, persist uploads under the configured media root, provision its shared Postgres role/database, expose service links and Cloudflare routes, and surface the config through dashboard and MCP tools.'
  },
  {
    slug: 'romm',
    name: 'RomM',
    logo: 'romm',
    category: 'Games',
    role: 'Private ROM and game-library manager',
    hero: 'RomM organizes emulator game libraries with metadata, artwork, saves, states, and browser-play workflows.',
    whatItDoes: [
      'Scans a structured ROM library and presents games by platform with artwork and metadata.',
      'Stores uploaded saves, states, custom assets, and config separately from the library folder.',
      'Uses Stackarr shared Postgres and Redis plus local resources paths so the game-library app state stays durable.'
    ],
    stackarr:
      'Stackarr can enable RomM as optional private game-library functionality, mount the configured Games folder, persist assets/resources under local app storage, expose localhost/Portless service links, and keep public routing opt-in only.'
  },
  {
    slug: 'questarr',
    name: 'Questarr',
    logo: 'questarr',
    category: 'Game downloads',
    role: 'Game discovery and acquisition app',
    hero: 'Questarr searches for games and coordinates downloads without replacing the game library managed by RomM.',
    whatItDoes: [
      'Uses IGDB metadata to support game discovery and requests.',
      'Connects to Prowlarr-compatible indexers and supported download clients from its own first-run UI.',
      'Can post-process completed downloads into an explicitly configured game destination.'
    ],
    stackarr:
      'Stackarr shares RomM’s IGDB credentials by default, mounts the common downloads and Games paths, and keeps Questarr private and optional. Questarr currently uses SQLite and does not synchronize RomM inventory, so RomM remains the source of truth.'
  },
  {
    slug: 'youtarr',
    name: 'Youtarr',
    logo: 'youtarr',
    logoExtension: 'png',
    category: 'YouTube downloads',
    role: 'YouTube channel tracker and library downloader',
    hero: 'Youtarr tracks YouTube channels, downloads selected videos, and can refresh a Plex library after completion.',
    whatItDoes: [
      'Tracks channels and queues individual YouTube videos for download.',
      'Uses yt-dlp and FFmpeg to create media files with metadata and artwork.',
      'Stores its application state in MariaDB and can trigger Plex library refreshes.'
    ],
    stackarr:
      'Stackarr keeps Youtarr optional and loopback-only by default, provisions a dedicated MariaDB service, persists media and application data, includes a consistent MariaDB dump in backups, applies the shared Stackarr login, and exposes focused MCP actions for health, library reads, and one-video download requests.'
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
      'Stackarr can include TinyMediaManager in setup, enable its private keyed HTTP API for approved scans and metadata actions, apply naming presets, link the visual service, and back up durable metadata databases while skipping rebuildable caches and add-ons.'
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
      'Stackarr generates only the enabled Recyclarr targets, removes stale template or disabled 4K files, wires app API keys, and offers a safe preview before an approved sync.'
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
    slug: 'redis',
    name: 'Redis',
    logo: 'redis',
    category: 'Data services',
    role: 'Shared cache and message broker',
    hero: 'Redis provides fast shared state for Stackarr apps that need caching, queues, or real-time coordination.',
    whatItDoes: [
      'Keeps frequently accessed application data in memory.',
      'Supports queues, pub/sub, and short-lived coordination between app processes.',
      'Provides a shared internal service without exposing another end-user dashboard.'
    ],
    stackarr:
      'Stackarr provisions one private Redis service for compatible apps such as Tracearr, Immich, and RomM, persists its durable data, monitors the container, and keeps it off the public service-link surface.'
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

const serviceSlugs = new Set(['cloudflare', 'docker', 'postgres', 'redis']);
const compareIntegrationNames = (left: ServiceIntegration, right: ServiceIntegration) =>
  left.name.localeCompare(right.name, 'en', { numeric: true, sensitivity: 'base' });

export const serviceIntegrationGroups = [
  {
    id: 'apps',
    name: 'Apps',
    services: serviceIntegrationDefinitions
      .filter((service) => !serviceSlugs.has(service.slug))
      .sort(compareIntegrationNames)
  },
  {
    id: 'services',
    name: 'Services',
    services: serviceIntegrationDefinitions
      .filter((service) => serviceSlugs.has(service.slug))
      .sort(compareIntegrationNames)
  }
] as const;

export const serviceIntegrations = serviceIntegrationGroups.flatMap((group) => group.services);

export const serviceIntegrationMap = new Map(serviceIntegrations.map((service) => [service.slug, service]));

export function getServiceIntegration(slug: string) {
  return serviceIntegrationMap.get(slug);
}

import { readEnv } from './env';
import { readNotifications } from './notifications';
import { readSettings } from './settings';

export type StackarrConnection = {
  name: string;
  target: string;
  kind: 'api' | 'config' | 'webhook' | 'public-url';
  status: 'configured' | 'needs-setup' | 'optional';
  description: string;
  managedFields: string[];
};

export type StackarrConnectionField = {
  name: string;
  label: string;
  type: 'text' | 'url' | 'password' | 'select' | 'checkbox';
  required?: boolean;
  placeholder?: string;
  options?: string[];
};

export type StackarrConnectionSchema = {
  implementation: string;
  name: string;
  target: string;
  kind: StackarrConnection['kind'];
  description: string;
  fields: StackarrConnectionField[];
  events?: string[];
};

export function getConnections(): StackarrConnection[] {
  const env = readEnv();
  const settings = readSettings();
  const notifications = readNotifications();
  const cloudflareRoutes = readCloudflareRoutes(env);

  return [
    {
      name: 'Radarr HD/4K',
      target: 'radarr',
      kind: 'api',
      status: 'configured',
      description:
        'Applies naming presets, download clients, archive hooks, Recyclarr quality sync, and Seerr request targets.',
      managedFields: ['Naming', 'Download clients', 'Custom Script', 'Quality profiles', 'Request routing']
    },
    {
      name: 'Sonarr HD/4K',
      target: 'sonarr',
      kind: 'api',
      status: 'configured',
      description:
        'Applies episode naming, download clients, archive hooks, Recyclarr quality sync, and Seerr TV routing.',
      managedFields: ['Naming', 'Download clients', 'Custom Script', 'Quality profiles', 'Request routing']
    },
    {
      name: 'Prowlarr',
      target: 'prowlarr',
      kind: 'api',
      status: 'configured',
      description:
        'Keeps application sync links for Radarr, Sonarr, and Lidarr aligned with Stackarr-managed indexer defaults.',
      managedFields: ['Applications', 'Indexer seed defaults', 'FlareSolverr proxy tags']
    },
    {
      name: 'Lidarr',
      target: 'lidarr',
      kind: 'api',
      status: 'configured',
      description: 'Receives the selected download client and shared category/path defaults.',
      managedFields: ['Download clients', 'Category paths']
    },
    {
      name: 'TinyMediaManager',
      target: 'tinymediamanager',
      kind: 'config',
      status: settings.metadata.tinyMediaManagerEnabled ? 'configured' : 'optional',
      description: 'Stackarr writes the TMM renamer preset so manual naming matches the arr import layout.',
      managedFields: ['Movie renamer pattern', 'TV renamer pattern']
    },
    {
      name: 'Bazarr',
      target: 'bazarr',
      kind: 'api',
      status: flag(env.ENABLE_BAZARR, true) ? 'configured' : 'optional',
      description: 'Keeps subtitle automation available beside the movie and TV import workflow.',
      managedFields: ['Base URL', 'API key', 'Subtitle defaults']
    },
    {
      name: 'Recyclarr',
      target: 'recyclarr',
      kind: 'config',
      status: flag(env.ENABLE_RECYCLARR, true) ? 'configured' : 'optional',
      description: 'Applies opinionated quality profile and custom-format sync presets into Radarr and Sonarr.',
      managedFields: ['Quality profiles', 'Custom formats', 'Sync config']
    },
    {
      name: 'FlareSolverr',
      target: 'flaresolverr',
      kind: 'api',
      status: flag(env.ENABLE_FLARESOLVERR, true) ? 'configured' : 'optional',
      description: 'Provides a browser-challenge proxy for Prowlarr indexers that need it.',
      managedFields: ['Proxy URL', 'Timeout', 'Prowlarr tags']
    },
    {
      name: 'Tidarr',
      target: 'tidarr',
      kind: 'api',
      status: flag(env.ENABLE_TIDARR, true) ? 'configured' : 'optional',
      description: 'Connects music acquisition workflows to the shared library and download-client defaults.',
      managedFields: ['Base URL', 'Music library', 'Download routing']
    },
    {
      name: 'Seerr',
      target: 'seerr',
      kind: 'api',
      status: 'configured',
      description: 'Stackarr configures request defaults and pins HD/4K media requests to the matching arr instances.',
      managedFields: ['Movie services', 'TV services', 'Request defaults', 'Public URL']
    },
    {
      name: 'Pulsarr',
      target: 'pulsarr',
      kind: 'api',
      status: flag(env.ENABLE_PULSARR, true) ? 'configured' : 'optional',
      description: 'Watches Plex watchlists and routes requested movies or shows into the matching Arr services.',
      managedFields: ['Base URL', 'Plex token', 'Arr routes', 'Authentication']
    },
    {
      name: 'Maintainerr',
      target: 'maintainerr',
      kind: 'api',
      status: flag(env.ENABLE_MAINTAINERR, false) ? 'configured' : 'optional',
      description: 'Connects Plex/Jellyfin cleanup planning to media-server, Arr, Seerr, and supported download-client settings.',
      managedFields: ['Media server', 'Radarr/Sonarr services', 'Seerr', 'qBittorrent', 'Cleanup preset notes']
    },
    {
      name: 'Cloudflare Tunnel',
      target: 'cloudflare',
      kind: 'public-url',
      status: cloudflareRoutes.length > 0 ? 'configured' : 'needs-setup',
      description: 'Publishes explicit Stackarr service routes while keeping admin apps private by default.',
      managedFields: ['Public routes', 'Tunnel ingress', 'DNS records']
    },
    {
      name: 'Plex',
      target: 'plex',
      kind: 'config',
      status: env.PLEX_INSTALL_MODE === 'disabled' ? 'optional' : 'configured',
      description: 'Monitors native server identity and can align Plex network preference metadata for macOS installs.',
      managedFields: ['Native config path', 'Preferences plist', 'Published server metadata']
    },
    {
      name: 'Jellyfin',
      target: 'jellyfin',
      kind: 'config',
      status: env.JELLYFIN_INSTALL_MODE === 'disabled' ? 'optional' : 'configured',
      description: 'Tracks the native or Docker Jellyfin mode for media-server monitoring and future library wiring.',
      managedFields: ['Install mode', 'Config path', 'Media roots']
    },
    {
      name: 'Notifications',
      target: 'webhook',
      kind: 'webhook',
      status: notifications.length > 0 ? 'configured' : 'optional',
      description: 'Arr-style webhook/custom-script events emitted by Stackarr command and health workflows.',
      managedFields: ['Event subscriptions', 'Webhook payloads', 'Custom script hooks']
    }
  ];
}

export function getConnectionSchemas(): StackarrConnectionSchema[] {
  return [
    {
      implementation: 'Radarr',
      name: 'Radarr',
      target: 'radarr',
      kind: 'api',
      description:
        'Manage movie naming, download client, custom script hooks, and Seerr routing for one Radarr instance.',
      fields: arrApiFields(7878)
    },
    {
      implementation: 'Sonarr',
      name: 'Sonarr',
      target: 'sonarr',
      kind: 'api',
      description:
        'Manage series naming, download client, custom script hooks, and Seerr routing for one Sonarr instance.',
      fields: arrApiFields(8989)
    },
    {
      implementation: 'Prowlarr',
      name: 'Prowlarr',
      target: 'prowlarr',
      kind: 'api',
      description: 'Sync arr applications, indexer defaults, and FlareSolverr proxy tags.',
      fields: arrApiFields(9696)
    },
    {
      implementation: 'Lidarr',
      name: 'Lidarr',
      target: 'lidarr',
      kind: 'api',
      description: 'Manage music download client routing and Lidarr-compatible Tidarr handoff defaults.',
      fields: arrApiFields(8686)
    },
    {
      implementation: 'Seerr',
      name: 'Seerr',
      target: 'seerr',
      kind: 'api',
      description: 'Configure request defaults, public URL, and HD/4K service targets.',
      fields: [
        urlField('Base URL', 'http://seerr:5055'),
        { name: 'apiKey', label: 'API Key', type: 'password', required: true },
        { name: 'publicUrl', label: 'Public URL', type: 'url', placeholder: 'https://request.example.com' }
      ]
    },
    {
      implementation: 'TinyMediaManager',
      name: 'TinyMediaManager',
      target: 'tinymediamanager',
      kind: 'config',
      description: 'Write Stackarr naming presets into TMM movie and TV renamer configuration.',
      fields: [
        {
          name: 'configPath',
          label: 'Config Path',
          type: 'text',
          required: true,
          placeholder: '/config/tinymediamanager'
        },
        { name: 'moviesTemplate', label: 'Movie Template', type: 'text', placeholder: '${title} (${year})' },
        {
          name: 'tvTemplate',
          label: 'TV Template',
          type: 'text',
          placeholder: '${showTitle} - S${seasonNr2}E${episodeNr2}'
        }
      ]
    },
    {
      implementation: 'Bazarr',
      name: 'Bazarr',
      target: 'bazarr',
      kind: 'api',
      description: 'Configure subtitle automation access and the shared language defaults Stackarr applies.',
      fields: [
        urlField('Base URL', 'http://bazarr:6767'),
        { name: 'apiKey', label: 'API Key', type: 'password' },
        { name: 'languages', label: 'Preferred Languages', type: 'text', placeholder: 'en' }
      ]
    },
    {
      implementation: 'FlareSolverr',
      name: 'FlareSolverr',
      target: 'flaresolverr',
      kind: 'api',
      description: 'Expose the FlareSolverr proxy endpoint to Prowlarr indexer proxy configuration.',
      fields: [
        urlField('Base URL', 'http://flaresolverr:8191'),
        { name: 'timeoutSeconds', label: 'Timeout Seconds', type: 'text', placeholder: '60' }
      ]
    },
    {
      implementation: 'Tidarr',
      name: 'Tidarr',
      target: 'tidarr',
      kind: 'api',
      description: 'Connect Tidarr as the Lidarr-compatible music acquisition workflow.',
      fields: [
        urlField('Base URL', 'http://tidarr:8484'),
        { name: 'adminPassword', label: 'Admin Password', type: 'password' },
        { name: 'libraryPath', label: 'Music Library Path', type: 'text', placeholder: '/music' }
      ]
    },
    {
      implementation: 'Recyclarr',
      name: 'Recyclarr',
      target: 'recyclarr',
      kind: 'config',
      description: 'Sync TRaSH-style quality and custom format presets into arr apps.',
      fields: [
        { name: 'configPath', label: 'Config Path', type: 'text', placeholder: '/config/recyclarr' },
        {
          name: 'profileSet',
          label: 'Profile Set',
          type: 'select',
          options: ['HD Lite', '4K Lite', 'Balanced', 'Custom']
        }
      ]
    },
    {
      implementation: 'Pulsarr',
      name: 'Pulsarr',
      target: 'pulsarr',
      kind: 'api',
      description: 'Connect Plex watchlists to Radarr/Sonarr and the optional 4K instances.',
      fields: [
        urlField('Base URL', 'http://pulsarr:3003'),
        { name: 'apiKey', label: 'API Key', type: 'password' },
        { name: 'plexToken', label: 'Plex Token', type: 'password' },
        {
          name: 'movieService',
          label: 'Movie Route',
          type: 'select',
          options: ['Radarr HD', 'Radarr 4K', 'Ask per item']
        },
        {
          name: 'seriesService',
          label: 'Series Route',
          type: 'select',
          options: ['Sonarr HD', 'Sonarr 4K', 'Ask per item']
        }
      ]
    },
    {
      implementation: 'Maintainerr',
      name: 'Maintainerr',
      target: 'maintainerr',
      kind: 'api',
      description: 'Connect media-server cleanup planning to the Stackarr service map and first-run setup.',
      fields: [
        urlField('Base URL', 'http://maintainerr:6246'),
        { name: 'mediaServer', label: 'Media Server', type: 'select', options: ['Plex', 'Jellyfin'] },
        { name: 'plexToken', label: 'Plex Token', type: 'password' },
        { name: 'jellyfinApiKey', label: 'Jellyfin API Key', type: 'password' },
        { name: 'movieService', label: 'Movie Services', type: 'text', placeholder: 'Radarr, Radarr 4K' },
        { name: 'seriesService', label: 'Series Services', type: 'text', placeholder: 'Sonarr, Sonarr 4K' },
        { name: 'downloadClient', label: 'Download Client', type: 'select', options: ['qBittorrent', 'None'] },
        {
          name: 'cleanupPresets',
          label: 'Cleanup Preset Ideas',
          type: 'text',
          placeholder: 'watched-movies,abandoned-shows,stale-requests'
        }
      ]
    },
    {
      implementation: 'Plex',
      name: 'Plex',
      target: 'plex',
      kind: 'config',
      description: 'Monitor native or Docker Plex identity and media-server metadata.',
      fields: [
        {
          name: 'installMode',
          label: 'Install Mode',
          type: 'select',
          options: ['native', 'docker', 'disabled'],
          required: true
        },
        {
          name: 'configPath',
          label: 'Config Path',
          type: 'text',
          placeholder: '/Users/name/Library/Application Support/Plex Media Server'
        },
        { name: 'host', label: 'Host', type: 'text', placeholder: 'host.docker.internal' }
      ]
    },
    {
      implementation: 'Jellyfin',
      name: 'Jellyfin',
      target: 'jellyfin',
      kind: 'config',
      description: 'Track Jellyfin native or Docker mode for monitoring and library wiring.',
      fields: [
        {
          name: 'installMode',
          label: 'Install Mode',
          type: 'select',
          options: ['native', 'docker', 'disabled'],
          required: true
        },
        { name: 'baseUrl', label: 'Base URL', type: 'url', placeholder: 'http://jellyfin:8096' },
        { name: 'apiKey', label: 'API Key', type: 'password' }
      ]
    },
    {
      implementation: 'Cloudflare',
      name: 'Cloudflare Tunnel Routes',
      target: 'cloudflare',
      kind: 'public-url',
      description: 'Expose only approved Stackarr service routes through Cloudflare Tunnel.',
      fields: [
        {
          name: 'hostname',
          label: 'Public hostname',
          type: 'text',
          required: true,
          placeholder: 'request.example.com'
        },
        {
          name: 'service',
          label: 'Stackarr service',
          type: 'select',
          options: ['pulsarr', 'seerr', 'bookorbit', 'maintainerr'],
          required: true
        },
        { name: 'apiToken', label: 'API Token', type: 'password' }
      ]
    },
    {
      implementation: 'Webhook',
      name: 'Webhook',
      target: 'webhook',
      kind: 'webhook',
      description: 'Send Stackarr events to another app using the arr-style notification workflow.',
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'url', label: 'Webhook URL', type: 'url', required: true }
      ],
      events: [
        'Test',
        'Health',
        'HealthRestored',
        'StackStart',
        'StackStop',
        'Configure',
        'Backup',
        'Update',
        'ServiceStateChange',
        'SetupComplete'
      ]
    },
    {
      implementation: 'CustomScript',
      name: 'Custom Script',
      target: 'webhook',
      kind: 'webhook',
      description: 'Run a local script for Stackarr events, matching the arr custom-script notification pattern.',
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'path', label: 'Script Path', type: 'text', required: true, placeholder: '/stackarr-hooks/on-event.sh' }
      ],
      events: ['Test', 'Health', 'StackStart', 'StackStop', 'Configure', 'Backup', 'Update', 'SetupComplete']
    }
  ];
}

function readCloudflareRoutes(env: Record<string, string | undefined>) {
  return parseCloudflareRoutes(env.CLOUDFLARE_TUNNEL_ROUTES);
}

function parseCloudflareRoutes(value: string | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((route) => {
      if (!route || typeof route !== 'object') {
        return false;
      }

      return Boolean((route as Record<string, unknown>).hostname);
    });
  } catch {
    return [];
  }
}

function flag(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === '') {
    return fallback;
  }

  return /^(1|true|yes|on)$/i.test(value);
}

function arrApiFields(defaultPort: number): StackarrConnectionField[] {
  return [
    urlField('Base URL', `http://service:${defaultPort}`),
    { name: 'apiKey', label: 'API Key', type: 'password', required: true },
    {
      name: 'instanceRole',
      label: 'Instance Role',
      type: 'select',
      options: ['HD', '4K', 'Music', 'Indexers', 'Custom']
    }
  ];
}

function urlField(label: string, placeholder: string): StackarrConnectionField {
  return { name: 'baseUrl', label, type: 'url', required: true, placeholder };
}

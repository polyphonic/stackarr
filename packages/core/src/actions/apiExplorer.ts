import { maybeServiceBaseUrl, selectedDownloader, serviceApiKey } from '../clients/serviceConfig';
import type { ToolCatalogEntry } from '../mcp/types';
import { getServices } from '../services';

export type ApiExplorerEndpoint = {
  method: string;
  path: string;
  summary: string;
  operationId?: string;
  tags: string[];
  deprecated: boolean;
};

export type ApiExplorerSource = {
  service: string;
  displayName: string;
  description: string;
  browserUrl?: string;
  configHref: string;
  contractPath: string;
  contractTitle: string;
  contractVersion?: string;
  openApiVersion?: string;
  endpoints: ApiExplorerEndpoint[];
};

export type ApiExplorerResult = {
  checkedAt: string;
  checkedServices: number;
  sources: ApiExplorerSource[];
};

export type AgentActionApiSource = {
  id: string;
  label: string;
  service?: string;
  explanation: string;
  configHref?: string;
};

export type AgentActionCatalogEntry = ToolCatalogEntry & {
  apiSources: AgentActionApiSource[];
};

type OpenApiDocument = {
  openapi?: unknown;
  swagger?: unknown;
  info?: { title?: unknown; version?: unknown };
  paths?: Record<string, Record<string, unknown>>;
};

const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']);
const contractCacheTtlMs = 5 * 60 * 1000;
let contractCache: { expiresAt: number; result: ApiExplorerResult } | undefined;

const preferredContractPaths: Record<string, string[]> = {
  sonarr: ['/api/v3/openapi.json', '/api/v3/swagger.json'],
  sonarr4k: ['/api/v3/openapi.json', '/api/v3/swagger.json'],
  radarr: ['/api/v3/openapi.json', '/api/v3/swagger.json'],
  radarr4k: ['/api/v3/openapi.json', '/api/v3/swagger.json'],
  prowlarr: ['/api/v1/openapi.json', '/api/v1/swagger.json'],
  lidarr: ['/api/v1/openapi.json', '/api/v1/swagger.json'],
  jellyfin: ['/api-docs/swagger.json', '/api-docs/openapi.json', '/openapi.json'],
  immich: ['/api/open-api', '/openapi.json'],
  seerr: ['/api/v1/openapi.json', '/openapi.json'],
  bazarr: ['/api/swagger.json', '/openapi.json'],
  pulsarr: ['/api/docs/openapi.json', '/api/openapi.json', '/openapi.json'],
  maintainerr: ['/api/docs-json', '/api-json', '/openapi.json'],
  cleanuparr: ['/swagger/v1/swagger.json', '/openapi.json'],
  tracearr: ['/api/v1/public/docs', '/api/openapi.json', '/api/docs/json', '/openapi.json'],
  romm: ['/openapi.json', '/api/openapi.json'],
  bookorbit: ['/openapi.json', '/api/openapi.json'],
  tinymediamanager: ['/api/openapi.json', '/openapi.json'],
  tidarr: ['/openapi.json', '/api/openapi.json']
};

export async function discoverInstalledApiContractsAction(
  options: { force?: boolean } = {}
): Promise<ApiExplorerResult> {
  const now = Date.now();
  if (!options.force && contractCache && contractCache.expiresAt > now) {
    return contractCache.result;
  }

  const services = getServices().filter(
    (service) =>
      service.name !== 'stackarr' &&
      service.mode !== 'disabled' &&
      Boolean(service.localUrl || service.browserUrl) &&
      Boolean(preferredContractPaths[service.name])
  );
  const discovered = await Promise.all(
    services.map(async (service) => {
      const baseUrl = maybeServiceBaseUrl(service.name);
      if (!baseUrl) return undefined;
      const contract = await discoverContract(service.name, baseUrl);
      if (!contract) return undefined;

      return {
        service: service.name,
        displayName: service.displayName,
        description: service.description,
        ...((service.browserUrl ?? service.localUrl) ? { browserUrl: service.browserUrl ?? service.localUrl } : {}),
        configHref: `/stack/services?app=${encodeURIComponent(service.name)}`,
        ...contract
      } satisfies ApiExplorerSource;
    })
  );
  const result: ApiExplorerResult = {
    checkedAt: new Date().toISOString(),
    checkedServices: services.length,
    sources: discovered
      .flatMap((source) => (source ? [source] : []))
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
  };
  contractCache = { expiresAt: now + contractCacheTtlMs, result };
  return result;
}

export function getAgentActionApiCatalog(tools: ToolCatalogEntry[]): AgentActionCatalogEntry[] {
  return tools.map((tool) => ({ ...tool, apiSources: apiSourcesForTool(tool) }));
}

async function discoverContract(service: string, baseUrl: string) {
  const candidates = preferredContractPaths[service] ?? [];
  const results = await Promise.all(
    candidates.map(async (contractPath) => {
      try {
        const response = await fetch(`${baseUrl}${contractPath}`, {
          headers: contractHeaders(service),
          redirect: 'error',
          signal: AbortSignal.timeout(1_800)
        });
        if (!response.ok || Number(response.headers.get('content-length') ?? 0) > 8_000_000) return undefined;
        const document = (await response.json()) as OpenApiDocument;
        if (!document || typeof document !== 'object' || !document.paths || typeof document.paths !== 'object') {
          return undefined;
        }
        const endpoints = normalizeEndpoints(document.paths);
        if (endpoints.length === 0) return undefined;
        return {
          contractPath,
          contractTitle:
            typeof document.info?.title === 'string' && document.info.title.trim()
              ? document.info.title.trim()
              : `${service} API`,
          ...(typeof document.info?.version === 'string' ? { contractVersion: document.info.version } : {}),
          ...(typeof document.openapi === 'string'
            ? { openApiVersion: document.openapi }
            : typeof document.swagger === 'string'
              ? { openApiVersion: `Swagger ${document.swagger}` }
              : {}),
          endpoints
        };
      } catch {
        return undefined;
      }
    })
  );

  return results.find(Boolean);
}

function normalizeEndpoints(paths: Record<string, Record<string, unknown>>): ApiExplorerEndpoint[] {
  const endpoints: ApiExplorerEndpoint[] = [];
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const [method, rawOperation] of Object.entries(pathItem)) {
      if (!methods.has(method.toLowerCase()) || !rawOperation || typeof rawOperation !== 'object') continue;
      const operation = rawOperation as Record<string, unknown>;
      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary:
          textValue(operation.summary) ||
          textValue(operation.description) ||
          textValue(operation.operationId) ||
          'No summary provided',
        ...(textValue(operation.operationId) ? { operationId: textValue(operation.operationId) } : {}),
        tags: Array.isArray(operation.tags)
          ? operation.tags.filter((tag): tag is string => typeof tag === 'string')
          : [],
        deprecated: operation.deprecated === true
      });
    }
  }
  return endpoints.sort(
    (left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method)
  );
}

function contractHeaders(service: string): Record<string, string> {
  const key = serviceApiKey(service);
  if (!key) return { accept: 'application/json' };
  if (['sonarr', 'sonarr4k', 'radarr', 'radarr4k', 'prowlarr', 'lidarr', 'seerr', 'bazarr'].includes(service)) {
    return { accept: 'application/json', 'X-Api-Key': key };
  }
  if (service === 'immich') return { accept: 'application/json', 'x-api-key': key };
  if (service === 'jellyfin') return { accept: 'application/json', 'X-Emby-Token': key };
  return { accept: 'application/json', authorization: `Bearer ${key}` };
}

function apiSourcesForTool(tool: ToolCatalogEntry): AgentActionApiSource[] {
  const name = tool.name;
  if (name.includes('pulsarr_'))
    return [serviceSource('pulsarr', 'Pulsarr API', 'Uses Pulsarr’s typed user and quota endpoints.')];
  if (name.includes('streamrip')) {
    const sources = [
      internalSource('Stackarr Streamrip worker', 'Uses Stackarr’s bounded Streamrip job and configuration layer.')
    ];
    if (name.includes('lidarr'))
      sources.push(
        serviceSource('lidarr', 'Lidarr API', 'Reads Lidarr album state before a bounded download workflow.')
      );
    return sources;
  }
  if (tool.category === 'arr') {
    if (name.includes('series') || name.includes('episode'))
      return [serviceSource('sonarr', 'Sonarr API', 'Uses Sonarr’s native v3 API.')];
    if (name.includes('movie')) return [serviceSource('radarr', 'Radarr API', 'Uses Radarr’s native v3 API.')];
    return [
      serviceSource('sonarr', 'Sonarr API', 'Reads or changes the configured TV automation instance.'),
      serviceSource('radarr', 'Radarr API', 'Reads or changes the configured movie automation instance.')
    ];
  }
  if (tool.category === 'releases') {
    const sources = [serviceSource('prowlarr', 'Prowlarr API', 'Uses Prowlarr’s native search and indexer endpoints.')];
    if (name.includes('downloader')) sources.push(downloaderSource());
    return sources;
  }
  if (tool.category === 'downloads') return [downloaderSource()];
  if (tool.category === 'plex') {
    const sources = [serviceSource('plex', 'Plex API', 'Uses Plex Media Server’s native HTTP API.')];
    if (name.includes('watch_summary')) {
      sources.push(
        serviceSource(
          'tracearr',
          'Tracearr API (optional)',
          'Used only when the action’s provider is explicitly set to Tracearr.'
        )
      );
    }
    return sources;
  }
  if (tool.category === 'seerr')
    return [serviceSource('seerr', 'Seerr API', 'Uses Seerr’s native request-management API.')];
  if (tool.category === 'apps') {
    return [
      {
        id: 'selected-app',
        label: 'Selected app API',
        explanation: 'Routes only to the app and named allowlisted operation supplied to the action.'
      }
    ];
  }
  if (tool.category === 'containers') {
    return [
      internalSource(
        'Docker Engine',
        'Uses the local Docker control surface; it does not depend on another optional app.'
      )
    ];
  }
  if (tool.category === 'automations') {
    return [
      internalSource(
        'Stackarr routines',
        'Stores the routine in Stackarr; each step then uses its selected app’s allowlisted API.'
      )
    ];
  }
  return [
    internalSource('Stackarr control plane', 'Handled by Stackarr’s own authenticated control plane and local runtime.')
  ];
}

function downloaderSource() {
  const downloader = selectedDownloader();
  return serviceSource(
    downloader,
    downloader === 'qbittorrent' ? 'qBittorrent API' : 'Transmission RPC',
    `Uses the currently selected ${downloader === 'qbittorrent' ? 'qBittorrent' : 'Transmission'} downloader.`
  );
}

function serviceSource(service: string, label: string, explanation: string): AgentActionApiSource {
  return {
    id: service,
    service,
    label,
    explanation,
    configHref: `/stack/services?app=${encodeURIComponent(service)}`
  };
}

function internalSource(label: string, explanation: string): AgentActionApiSource {
  return { id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), label, explanation };
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

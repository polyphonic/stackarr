import { plexGet } from '../clients/plex';
import { serviceApiKey } from '../clients/serviceConfig';
import { getStackMetrics } from '../metrics';
import { getServices } from '../services';
import { getDockerContainerOverviewAction } from './containers';

type PlexResourcePoint = {
  at?: string | number;
  timespan?: string | number;
  hostCpuUtilization?: string | number;
  processCpuUtilization?: string | number;
  hostMemoryUtilization?: string | number;
  processMemoryUtilization?: string | number;
};

type PlexResourceResponse = {
  MediaContainer?: { StatisticsResources?: PlexResourcePoint | PlexResourcePoint[] };
};

export type HomelabPerformancePoint = {
  at: number;
  hostCpuPercent: number;
  appCpuPercent: number;
  hostMemoryPercent: number;
  appMemoryPercent: number;
};

export type HomelabPerformance = {
  available: boolean;
  provider: 'plex' | 'docker' | 'host';
  sourceLabel: string;
  appLabel?: string;
  generatedAt: string;
  points: HomelabPerformancePoint[];
  note?: string;
};

export async function getHomelabPerformanceAction(): Promise<HomelabPerformance> {
  const services = getServices();
  const plex = services.find((service) => service.name === 'plex' && service.mode !== 'disabled');

  if (plex && serviceApiKey('plex')) {
    try {
      const response = await plexGet<PlexResourceResponse>('statistics/resources', { timespan: 6 });
      const raw = response.MediaContainer?.StatisticsResources;
      const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const points = rows
        .map((point) => ({
          at: finiteNumber(point.at),
          hostCpuPercent: finiteNumber(point.hostCpuUtilization),
          appCpuPercent: finiteNumber(point.processCpuUtilization),
          hostMemoryPercent: finiteNumber(point.hostMemoryUtilization),
          appMemoryPercent: finiteNumber(point.processMemoryUtilization)
        }))
        .filter((point) => point.at > 0)
        .sort((a, b) => a.at - b.at);

      if (points.length > 0) {
        return {
          available: true,
          provider: 'plex',
          sourceLabel: 'Plex native telemetry',
          appLabel: 'Plex',
          generatedAt: new Date().toISOString(),
          points
        };
      }
    } catch {
      // Fall through to container telemetry so the dashboard remains useful.
    }
  }

  return dockerOrHostPerformance(services);
}

async function dockerOrHostPerformance(services: ReturnType<typeof getServices>): Promise<HomelabPerformance> {
  const host = getStackMetrics([]).performance;
  const enabled = services.filter(
    (service) => service.name !== 'stackarr' && service.mode !== 'disabled' && service.experience === 'app'
  );
  const preferred = [...enabled].sort((left, right) => appTelemetryRank(left.name) - appTelemetryRank(right.name))[0];
  const now = Math.floor(Date.now() / 1000);

  if (preferred) {
    try {
      const overview = await getDockerContainerOverviewAction();
      const container = overview.containers.find((item) => containerMatchesApp(item.composeService, preferred.name));
      if (container?.stats) {
        const memoryPercent = container.stats.memoryLimitBytes
          ? (container.stats.memoryBytes / container.stats.memoryLimitBytes) * 100
          : 0;
        return {
          available: true,
          provider: 'docker',
          sourceLabel: `${preferred.displayName} container telemetry`,
          appLabel: preferred.displayName,
          generatedAt: new Date().toISOString(),
          points: [
            {
              at: now,
              hostCpuPercent: host.cpuLoadPercent,
              appCpuPercent: container.stats.cpuPercent,
              hostMemoryPercent: host.memoryUsedPercent,
              appMemoryPercent: memoryPercent
            }
          ]
        };
      }
    } catch {
      // Host telemetry below is still useful when Docker cannot be sampled.
    }
  }

  return {
    available: true,
    provider: 'host',
    sourceLabel: preferred ? 'Host telemetry' : 'Stackarr host telemetry',
    generatedAt: new Date().toISOString(),
    points: [
      {
        at: now,
        hostCpuPercent: host.cpuLoadPercent,
        appCpuPercent: 0,
        hostMemoryPercent: host.memoryUsedPercent,
        appMemoryPercent: 0
      }
    ],
    note: preferred ? `${preferred.displayName} is configured but its container metrics are unavailable.` : undefined
  };
}

function containerMatchesApp(composeService: string | undefined, app: string) {
  const service = composeService?.toLowerCase() ?? '';
  if (app === 'immich') return service === 'immich' || service === 'immich-server';
  if (app === 'tinymediamanager') return service === 'tinymediamanager' || service === 'tinymm';
  return service === app || service.startsWith(`${app}-`);
}

function appTelemetryRank(name: string) {
  const order = ['jellyfin', 'immich', 'romm', 'tracearr', 'plex'];
  const index = order.indexOf(name);
  return index === -1 ? order.length : index;
}

function finiteNumber(value: string | number | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

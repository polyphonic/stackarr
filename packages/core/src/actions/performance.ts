import { plexGet } from '../clients/plex';
import { serviceApiKey } from '../clients/serviceConfig';
import { getServices } from '../services';

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
  provider: 'plex' | 'docker';
  sourceLabel: string;
  generatedAt: string;
  points: HomelabPerformancePoint[];
  note?: string;
};

export async function getHomelabPerformanceAction(): Promise<HomelabPerformance> {
  const plex = getServices().find((service) => service.name === 'plex' && service.mode !== 'disabled');
  const fallback = (note: string): HomelabPerformance => ({
    available: false,
    provider: 'docker',
    sourceLabel: 'Docker live metrics',
    generatedAt: new Date().toISOString(),
    points: [],
    note
  });

  if (!plex || !serviceApiKey('plex')) {
    return fallback(
      'Connect Plex to show native CPU and memory history here. Docker live metrics remain available in Infrastructure.'
    );
  }

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

    if (points.length === 0) {
      return fallback(
        'Plex did not return resource history. This endpoint may require Plex Pass; Docker live metrics remain available.'
      );
    }

    return {
      available: true,
      provider: 'plex',
      sourceLabel: 'Plex native telemetry',
      generatedAt: new Date().toISOString(),
      points
    };
  } catch {
    return fallback(
      'Plex resource history is temporarily unavailable. Docker live metrics remain available in Infrastructure.'
    );
  }
}

function finiteNumber(value: string | number | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

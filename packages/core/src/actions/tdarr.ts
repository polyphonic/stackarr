import { requestJson } from '../clients/http';
import { serviceBaseUrl } from '../clients/serviceConfig';
import { readEnv } from '../env';

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
}

async function tdarrRequest(path: string, body?: unknown) {
  const env = readEnv();
  if (env.ENABLE_TDARR !== 'true') throw new Error('Tdarr is disabled. Enable it in Apps first.');
  if (env.TDARR_AUTH !== 'false' && !env.TDARR_API_KEY) throw new Error('Tdarr API key is not configured.');
  return requestJson<unknown>(`${serviceBaseUrl('tdarr')}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    body,
    headers: env.TDARR_API_KEY ? { 'x-api-key': env.TDARR_API_KEY } : undefined,
    timeoutMs: 10_000,
    allowTextResponse: true
  });
}

function boundedLimit(limit = 20) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be an integer from 1 to 100.');
  return limit;
}

export async function getTdarrStatusAction() {
  const status = record(await tdarrRequest('/api/v2/status'));
  return { status: status.status, version: status.version, uptime: status.uptime, serverEngine: status.serverEngine };
}

export async function listTdarrLibrariesAction({ limit = 20 }: { limit?: number } = {}) {
  boundedLimit(limit);
  const data = await tdarrRequest('/api/v2/cruddb', { data: { collection: 'LibrarySettingsJSONDB', mode: 'getAll' } });
  if (!Array.isArray(data)) throw new Error('Unexpected Tdarr library response.');
  return {
    total: data.length,
    libraries: data.slice(0, limit).map((value) => {
      const library = record(value);
      return {
        id: library._id,
        name: library.name,
        source: library.folder,
        cache: library.cache,
        transcodeEnabled: library.processTranscodes,
        healthChecksEnabled: library.processHealthChecks
      };
    })
  };
}

export async function listTdarrNodesAction({ limit = 20 }: { limit?: number } = {}) {
  boundedLimit(limit);
  const data = record(await tdarrRequest('/api/v2/get-nodes'));
  const nodes = Object.entries(data);
  return {
    total: nodes.length,
    nodes: nodes.slice(0, limit).map(([id, value]) => {
      const node = record(value);
      return { id, name: node.nodeName, paused: node.nodePaused, workers: Object.keys(record(node.workers)).length };
    })
  };
}

export async function pauseTdarrNodeAction({ nodeId }: { nodeId: string }) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(nodeId)) throw new Error('Invalid Tdarr node ID.');
  const nodes = record(await tdarrRequest('/api/v2/get-nodes'));
  if (!Object.hasOwn(nodes, nodeId)) throw new Error('Tdarr node is not connected.');
  await tdarrRequest('/api/v2/update-node', { data: { nodeID: nodeId, nodeUpdates: { nodePaused: true } } });
  return { nodeId, pauseRequested: true };
}

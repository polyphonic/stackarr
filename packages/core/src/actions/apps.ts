import { requestJson } from '../clients/http';
import { maybeServiceBaseUrl, serviceApiKey } from '../clients/serviceConfig';
import { readEnv } from '../env';
import { redactSecrets } from '../safety/redaction';
import { getServices } from '../services';

export const nativeAppNames = ['jellyfin', 'immich', 'romm', 'maintainerr', 'tracearr', 'bookorbit'] as const;

export type NativeAppName = (typeof nativeAppNames)[number];

type Operation = {
  method: 'GET' | 'POST';
  path: string | ((input: NativeAppOperationInput) => string);
  description: string;
  credential: 'none' | 'optional-bearer' | 'jellyfin' | 'immich';
  input?: 'libraryId';
};

type NativeAppDefinition = {
  warning?: string;
  reads: Record<string, Operation>;
  manages: Record<string, Operation>;
};

export type NativeAppOperationInput = {
  app: NativeAppName;
  operation: string;
  libraryId?: string;
};

const definitions: Record<NativeAppName, NativeAppDefinition> = {
  jellyfin: {
    reads: {
      public_info: operation('GET', '/System/Info/Public', 'Read public server identity.', 'none'),
      system_info: operation('GET', '/System/Info', 'Read authenticated server information.', 'jellyfin'),
      libraries: operation('GET', '/Library/VirtualFolders', 'List configured media libraries.', 'jellyfin'),
      sessions: operation('GET', '/Sessions', 'List active Jellyfin sessions.', 'jellyfin')
    },
    manages: {
      refresh_library: operation('POST', '/Library/Refresh', 'Start a Jellyfin library scan.', 'jellyfin')
    }
  },
  immich: {
    reads: {
      about: operation('GET', '/api/server/about', 'Read Immich server information.', 'immich'),
      statistics: operation('GET', '/api/server/statistics', 'Read library asset statistics.', 'immich'),
      storage: operation('GET', '/api/server/storage', 'Read Immich storage usage.', 'immich'),
      libraries: operation('GET', '/api/libraries', 'List external libraries.', 'immich')
    },
    manages: {
      scan_library: {
        ...operation(
          'POST',
          (input) => `/api/libraries/${pathIdentifier(input.libraryId, 'libraryId')}/scan`,
          'Start an external-library scan.',
          'immich'
        ),
        input: 'libraryId'
      }
    }
  },
  romm: {
    reads: {
      heartbeat: operation('GET', '/api/heartbeat', 'Read RomM availability and feature flags.', 'optional-bearer'),
      statistics: operation('GET', '/api/stats', 'Read RomM library statistics.', 'optional-bearer')
    },
    manages: {}
  },
  maintainerr: {
    warning: 'Maintainerr does not provide API authentication. Keep it on a trusted private network.',
    reads: {
      live: operation('GET', '/api/health/live', 'Read the process liveness result.', 'none'),
      ready: operation('GET', '/api/health/ready', 'Read dependency readiness.', 'none'),
      health: operation('GET', '/api/health', 'Read the combined health result.', 'none'),
      storage_metrics: operation('GET', '/api/storage-metrics', 'Read cached storage metrics.', 'none')
    },
    manages: {}
  },
  tracearr: {
    reads: {},
    manages: {}
  },
  bookorbit: {
    reads: {
      health: operation('GET', '/api/v1/health', 'Read BookOrbit service health.', 'none')
    },
    manages: {}
  }
};

export function getNativeAppCapabilitiesAction() {
  const enabledServices = new Set(
    getServices()
      .filter((service) => service.mode !== 'disabled')
      .map((service) => service.name)
  );

  return {
    apps: nativeAppNames.map((app) => {
      const definition = definitions[app];
      const credential = serviceApiKey(app);
      return {
        app,
        enabled: enabledServices.has(app),
        configured: Boolean(maybeServiceBaseUrl(app)),
        credentialConfigured: Boolean(credential),
        readOperations: summarizeOperations(definition.reads),
        manageOperations: summarizeOperations(definition.manages),
        ...(definition.warning ? { warning: definition.warning } : {})
      };
    }),
    design: {
      routing: 'allowlisted-native-api',
      arbitraryRequestsAllowed: false,
      note: 'Only operations listed for enabled apps can be called. Credentials are never returned.'
    }
  };
}

export async function readNativeAppAction(input: NativeAppOperationInput) {
  return runOperation('read', input);
}

export async function manageNativeAppAction(input: NativeAppOperationInput) {
  return runOperation('manage', input);
}

export function assertNativeAppOperationSupported(kind: 'read' | 'manage', input: NativeAppOperationInput) {
  const operations = kind === 'read' ? definitions[input.app].reads : definitions[input.app].manages;
  if (!operations[input.operation]) {
    throw new Error(
      `Unsupported ${kind} operation "${input.operation}" for ${input.app}. Available: ${Object.keys(operations).join(', ') || 'none'}.`
    );
  }
  if (operations[input.operation].input === 'libraryId') pathIdentifier(input.libraryId, 'libraryId');
}

async function runOperation(kind: 'read' | 'manage', input: NativeAppOperationInput) {
  assertEnabled(input.app);
  const definition = definitions[input.app];
  const operations = kind === 'read' ? definition.reads : definition.manages;
  assertNativeAppOperationSupported(kind, input);
  const selected = operations[input.operation];

  const key = serviceApiKey(input.app);
  const headers = authHeaders(selected.credential, key, input.app);
  const path = typeof selected.path === 'function' ? selected.path(input) : selected.path;
  const result = await requestJson<unknown>(`${requiredBaseUrl(input.app)}${path}`, {
    method: selected.method,
    headers,
    timeoutMs: kind === 'manage' ? 15_000 : 10_000
  });

  return {
    app: input.app,
    operation: input.operation,
    kind,
    result: boundedResult(redactSecrets(result))
  };
}

function operation(
  method: Operation['method'],
  path: Operation['path'],
  description: string,
  credential: Operation['credential']
): Operation {
  return { method, path, description, credential };
}

function summarizeOperations(operations: Record<string, Operation>) {
  return Object.entries(operations).map(([name, value]) => ({
    name,
    description: value.description,
    ...(value.input ? { requiredInput: [value.input] } : {})
  }));
}

function assertEnabled(app: NativeAppName) {
  const service = getServices().find((item) => item.name === app);
  if (!service || service.mode === 'disabled') {
    throw new Error(`${app} is not enabled in this Stackarr installation.`);
  }
}

function requiredBaseUrl(app: NativeAppName) {
  const baseUrl = maybeServiceBaseUrl(app);
  if (!baseUrl) throw new Error(`${app} does not have a configured HTTP endpoint.`);
  if (app === 'maintainerr') {
    const basePath = readEnv().MAINTAINERR_BASE_PATH?.trim() ?? '';
    if (basePath && !/^\/[a-zA-Z0-9/_-]*$/.test(basePath)) throw new Error('Maintainerr base path is invalid.');
    return `${baseUrl}${basePath.replace(/\/$/, '')}`;
  }
  return baseUrl;
}

function authHeaders(
  credential: Operation['credential'],
  key: string | undefined,
  app: NativeAppName
): Record<string, string> | undefined {
  if (credential === 'none') return undefined;
  if (!key && credential !== 'optional-bearer') {
    throw new Error(`${app} requires an API key before this operation can be used.`);
  }
  if (!key) return undefined;
  if (credential === 'jellyfin') return { 'X-Emby-Token': key };
  if (credential === 'immich') return { 'x-api-key': key };
  return { authorization: `Bearer ${key}` };
}

function pathIdentifier(value: string | undefined, name: string) {
  if (!value || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) {
    throw new Error(`${name} must contain only letters, numbers, underscores, or hyphens.`);
  }
  return encodeURIComponent(value);
}

function boundedResult(value: unknown) {
  const serialized = JSON.stringify(value);
  if (serialized.length > 250_000) {
    throw new Error('The native app response exceeded the 250 KB safety limit. Narrow the operation in the app first.');
  }
  return value;
}

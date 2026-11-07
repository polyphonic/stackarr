import { editableEnvKeys, isCredentialConfigKey, isSecretKey, redactEnv, redactSecrets } from '@stackarr/core';
import { planConfigurationChange, readExistingConfigurationSnapshot } from '@stackarr/core/configurationControl';

const unavailable = () => ({
  accepted: false,
  error:
    'Generic MCP configuration mutation capability unavailable. Use authenticated settings or an existing specialized tool; no configuration was read or changed.'
});
const category = (key: string) =>
  /BACKUP|RETENTION|STAGING/.test(key)
    ? 'backup'
    : /SCHEDULE|UPDATE_TIME|UPDATE_WEEKDAY/.test(key)
      ? 'schedules'
      : /PASSWORD|TOKEN|SECRET|API_KEY|USERNAME|USER_EMAIL|ACCESS|AUTH|SSL|TLS/.test(key)
        ? 'security'
        : /POSTGRES|DATABASE|REDIS|MARIADB|DB_/.test(key)
          ? 'database'
          : /ROOT|PATH|MEDIA|DOWNLOAD/.test(key)
            ? 'storage'
            : 'general';

export function discoverConfigurationAction() {
  const { settings } = readExistingConfigurationSnapshot();
  return {
    env: editableEnvKeys.map((key) => ({
      key,
      category: category(key),
      secret: isSecretKey(key) || isCredentialConfigKey(key) || /DATABASE_URL|BACKUP_URL/.test(key),
      write: 'generic-mcp-unavailable'
    })),
    settings: Object.fromEntries(
      Object.entries(settings).map(([section, values]) => [
        section,
        Object.keys(values).map((key) => ({ key, write: 'generic-mcp-unavailable' }))
      ])
    ),
    presets: ['naming', 'downloads', 'requests'].map((name) => ({ name, write: 'generic-mcp-unavailable' })),
    services: [],
    specialized: [
      {
        category: 'security/account',
        write: 'authenticated account/settings UI or existing named connection-policy tools'
      },
      {
        category: 'backup/schedules',
        write: 'authenticated settings UI and specialized backup workflows only after restore prerequisites'
      },
      { category: 'database', write: 'authenticated Advanced settings UI; no generic MCP endpoint mutation' },
      {
        category: 'Cloudflare/telemetry',
        write: 'existing named Cloudflare and telemetry tools with their own approval/consent rules'
      },
      {
        category: 'Streamrip/native apps',
        write: 'existing named Streamrip/native-app tools with their own validators and risk scopes'
      }
    ],
    limitations: [
      'Generic MCP configuration mutations and service catalog preview are unavailable.',
      'SQLite read-only snapshot requires initialized settings; PostgreSQL has no non-migrating snapshot reader.',
      'Settings-only preview is provisional and not a commit plan; no scheduler or credential input is accepted.'
    ]
  };
}

export function readConfigurationAction() {
  const { env, settings } = readExistingConfigurationSnapshot();
  const redacted = redactEnv(env);
  return {
    env: Object.fromEntries(
      editableEnvKeys.map((key) => [
        key,
        isSecretKey(key) || isCredentialConfigKey(key) || /DATABASE_URL|BACKUP_URL/.test(key)
          ? env[key]
            ? '********'
            : ''
          : redactSecrets(redacted[key] ?? '')
      ])
    ),
    settings: redactSecrets(settings),
    services: [],
    note: 'Initialized SQLite snapshot only; no defaults initialized. Service catalog is unavailable without initialization.'
  };
}

export function previewStackConfigurationAction(input: unknown) {
  // Reject prohibited fields before opening the snapshot.
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== 'settings')
  )
    throw new Error(
      'Environment, scheduler, credential, proof and host-owned inputs are unavailable through this MCP preview.'
    );
  const { env, settings } = readExistingConfigurationSnapshot();
  return planConfigurationChange(input, env, settings);
}

export function updateSafeStackConfigurationAction(_input: unknown) {
  return unavailable();
}
export function updateSafeServiceConfigurationAction(_input: unknown) {
  return unavailable();
}
export function previewServiceConfigurationAction(_input: unknown) {
  return unavailable();
}

/** Guidance only: configured endpoints are not a migration or connectivity test. */
export function getNativeDatabaseGuidanceAction() {
  const { env } = readExistingConfigurationSnapshot();
  const mode = ['external', 'independent'].includes(env.POSTGRES_DEPLOYMENT_MODE ?? '') ? 'external' : 'managed';
  return {
    mode,
    managedDefault: 'unified TimescaleDB container',
    existingServerConnection:
      'External mode points participating apps at an existing owner-managed server. Saving endpoints does not provision roles, databases, extensions, copy data, or migrate schemas.',
    prerequisites: [
      'Confirm engine major version and per-app required extensions.',
      'Create and verify per-app roles and databases on the external server before switching endpoints.',
      'Verify network reachability, credentials and TLS independently with read-only authenticated database diagnostics.',
      'Capture and restore matching-engine local/full-file and remote archives in isolation; compare schema, extensions and data.',
      'Record old endpoints, stop writers during planned cutover and rehearse rollback before applying.'
    ],
    backupCoverage: {
      localEnabled: env.ENABLE_BACKUP === 'true',
      remoteArchiveEnabled: env.STACKARR_PG_BACKUP_ENABLED === 'true',
      remoteTargetConfigured: Boolean(env.STACKARR_PG_BACKUP_URL),
      warning:
        'Flags and target URL do not prove backup coverage. Verify source, reachable target, credentials, scheduler ownership, and matching-engine restore. Never prune unverified generations.'
    },
    nextStep:
      'Use authenticated Advanced database settings and read-only diagnostics; generic MCP configuration mutations are unavailable.'
  };
}

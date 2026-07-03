'use client';

import { toast } from '@stackarr/ui/toast';
import { useMemo, useState } from 'react';
import { stackarrFetch, storeStackarrApiKeyFromBody } from './clientApi';
import { PathInput } from './PathPicker';
import styles from './SetupWizard.module.css';
import { TaskProgressView, useLiveTasks } from './TaskProgress';

type SetupMode = 'fresh' | 'restore' | 'migrate';

const portablePasswordPattern = /^[A-Za-z0-9._-]+$/;
const portablePasswordDescription = 'letters, numbers, dot, underscore, and hyphen';
const portablePasswordMinimumLength = 8;

const steps = [
  'Welcome',
  'Storage Paths',
  'Media Servers',
  'Media Requests',
  'Stack Services',
  'Account',
  'Database',
  'Torrent Client',
  'Automation',
  'Agent Plugins',
  'Presets',
  'Review',
  'Run Setup'
];

type SetupState = {
  mediaRoot: string;
  musicRoot: string;
  downloadsRoot: string;
  backupRoot: string;
  plexInstallMode: string;
  jellyfinInstallMode: string;
  enableMovies: boolean;
  enableTvShows: boolean;
  enable4kServarr: boolean;
  enableBazarr: boolean;
  enableLidarr: boolean;
  enableBookOrbit: boolean;
  enableTinyMediaManager: boolean;
  enableRecyclarr: boolean;
  enableFlaresolverr: boolean;
  enableTidarr: boolean;
  movieProfilePreset: string;
  movie4kProfilePreset: string;
  tvProfilePreset: string;
  tv4kProfilePreset: string;
  musicProfilePreset: string;
  enableRequestManagement: boolean;
  enableSeerr: boolean;
  configureSeerr: boolean;
  enablePulsarr: boolean;
  globalUsername: string;
  globalPassword: string;
  globalEmail: string;
  databaseMode: string;
  preferredTorrentClient: string;
  seerrBindIp: string;
  transmissionBindIp: string;
  qbittorrentBindIp: string;
  webPort: string;
  installStartup: boolean;
  installBackup: boolean;
  installUpdates: boolean;
  installHermesPlugin: boolean;
  installOpenClawPlugin: boolean;
};

const defaults: SetupState = {
  mediaRoot: '/stackarr/media',
  musicRoot: '/stackarr/media/Music',
  downloadsRoot: '/stackarr/downloads',
  backupRoot: '/stackarr/backups',
  plexInstallMode: 'native',
  jellyfinInstallMode: 'disabled',
  enableMovies: true,
  enableTvShows: true,
  enable4kServarr: false,
  enableBazarr: true,
  enableLidarr: true,
  enableBookOrbit: false,
  enableTinyMediaManager: true,
  enableRecyclarr: true,
  enableFlaresolverr: true,
  enableTidarr: true,
  movieProfilePreset: 'lite',
  movie4kProfilePreset: 'lite',
  tvProfilePreset: 'lite',
  tv4kProfilePreset: 'lite',
  musicProfilePreset: 'lossless',
  enableRequestManagement: true,
  enableSeerr: false,
  configureSeerr: false,
  enablePulsarr: true,
  globalUsername: 'admin',
  globalPassword: '',
  globalEmail: '',
  databaseMode: 'app-default',
  preferredTorrentClient: 'transmission',
  seerrBindIp: '0.0.0.0',
  transmissionBindIp: '127.0.0.1',
  qbittorrentBindIp: '127.0.0.1',
  webPort: '7777',
  installStartup: true,
  installBackup: true,
  installUpdates: false,
  installHermesPlugin: false,
  installOpenClawPlugin: false
};

export function SetupWizard({ initialDefaults = {} }: { initialDefaults?: Partial<SetupState> }) {
  const resolvedDefaults = useMemo(() => ({ ...defaults, ...initialDefaults }), [initialDefaults]);
  const [setupMode, setSetupMode] = useState<SetupMode>('fresh');
  const [step, setStep] = useState(0);
  const [state, setState] = useState(resolvedDefaults);
  const [message, setMessage] = useState('');
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restorePostgres, setRestorePostgres] = useState(true);
  const [restoreNativePlex, setRestoreNativePlex] = useState(false);
  const [restorePlexPreferences, setRestorePlexPreferences] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState('');
  const [migrateSourceRoot, setMigrateSourceRoot] = useState('');
  const [migrateStopSourceContainers, setMigrateStopSourceContainers] = useState(true);
  const [migratePlan, setMigratePlan] = useState('');
  const [migrateMessage, setMigrateMessage] = useState('');
  const [setupTaskId, setSetupTaskId] = useState('');
  const [setupBusy, setSetupBusy] = useState(false);
  const current = steps[step];
  const jellyfinEnabled = state.jellyfinInstallMode !== 'disabled';
  const effectiveEnableSeerr = state.enableRequestManagement && state.enableSeerr;
  const effectiveEnablePulsarr = state.enableRequestManagement && !jellyfinEnabled && state.enablePulsarr;
  const passwordValidationMessage = validateRequiredPortablePassword(state.globalPassword);
  const liveTasks = useLiveTasks([], { limit: 10 });
  const setupTask = setupTaskId ? liveTasks.find((task) => task.id === setupTaskId) : undefined;

  const setupConfig = useMemo(() => {
    const config: Record<string, string> = {
      MEDIA_ROOT: state.mediaRoot,
      MUSIC_ROOT: state.musicRoot,
      DOWNLOADS_ROOT: state.downloadsRoot,
      BACKUP_ROOT: state.backupRoot,
      ENABLE_BACKUP: String(state.installBackup),
      BACKUP_TIME: '02:00',
      BACKUP_SCHEDULE: 'weekly',
      BACKUP_WEEKDAY: 'Sun',
      BACKUP_RETENTION_COUNT: '52',
      ENABLE_SCHEDULED_UPDATES: String(state.installUpdates),
      UPDATE_TIME: '04:30',
      UPDATE_WEEKDAY: 'Sun',
      PLEX_INSTALL_MODE: state.plexInstallMode,
      JELLYFIN_INSTALL_MODE: state.jellyfinInstallMode,
      ENABLE_MOVIES: String(state.enableMovies),
      ENABLE_TV_SHOWS: String(state.enableTvShows),
      ENABLE_4K_SERVARR: String(state.enable4kServarr),
      ENABLE_BAZARR: String(state.enableBazarr),
      ENABLE_LIDARR: String(state.enableLidarr),
      ENABLE_BOOKORBIT: String(state.enableBookOrbit),
      ENABLE_TINYMEDIAMANAGER: String(state.enableTinyMediaManager),
      ENABLE_RECYCLARR: String(state.enableRecyclarr),
      ENABLE_FLARESOLVERR: String(state.enableFlaresolverr),
      ENABLE_TIDARR: String(state.enableTidarr),
      STACKARR_MOVIE_PROFILE_PRESET: state.movieProfilePreset,
      STACKARR_TV_PROFILE_PRESET: state.tvProfilePreset,
      STACKARR_MUSIC_PROFILE_PRESET: state.musicProfilePreset,
      STACKARR_MOVIE_DEFAULT_PROFILE: mediaProfileName(state.movieProfilePreset, 'hd'),
      STACKARR_TV_DEFAULT_PROFILE: mediaProfileName(state.tvProfilePreset, 'hd'),
      STACKARR_MUSIC_DEFAULT_PROFILE: musicProfileName(state.musicProfilePreset),
      ENABLE_SEERR: String(effectiveEnableSeerr),
      STACKARR_CONFIGURE_SEERR: String(effectiveEnableSeerr && state.configureSeerr),
      ENABLE_PULSARR: String(effectiveEnablePulsarr),
      USERNAME: state.globalUsername,
      PASSWORD: state.globalPassword,
      USER_EMAIL: state.globalEmail,
      STACKARR_DATABASE_MODE: state.databaseMode,
      PREFERRED_TORRENT_CLIENT: state.preferredTorrentClient,
      SEERR_BIND_IP: state.seerrBindIp,
      TRANSMISSION_BIND_IP: state.transmissionBindIp,
      QBITTORRENT_BIND_IP: state.qbittorrentBindIp,
      STACKARR_WEB_ENABLED: 'true',
      STACKARR_BIND_IP: '127.0.0.1',
      STACKARR_WEB_PORT: state.webPort,
      BOOKORBIT_BIND_IP: '127.0.0.1',
      BOOKORBIT_WEB_PORT: '7582',
      BOOKORBIT_CONTAINER_PORT: '7582',
      BOOKORBIT_URL: 'http://127.0.0.1:7582',
      BOOKORBIT_APP_URL: 'http://127.0.0.1:7582',
      BOOKORBIT_CLIENT_URL: 'http://127.0.0.1:7582',
      BOOKS_ROOT: `${state.mediaRoot}/Books`,
      STACKARR_MOVIE_4K_PROFILE_PRESET: '',
      STACKARR_TV_4K_PROFILE_PRESET: '',
      STACKARR_MOVIE_4K_DEFAULT_PROFILE: '',
      STACKARR_TV_4K_DEFAULT_PROFILE: ''
    };

    if (state.enable4kServarr) {
      config.STACKARR_MOVIE_4K_PROFILE_PRESET = state.movie4kProfilePreset;
      config.STACKARR_TV_4K_PROFILE_PRESET = state.tv4kProfilePreset;
      config.STACKARR_MOVIE_4K_DEFAULT_PROFILE = mediaProfileName(state.movie4kProfilePreset, '4k');
      config.STACKARR_TV_4K_DEFAULT_PROFILE = mediaProfileName(state.tv4kProfilePreset, '4k');
    } else {
      config.RADARR4K_API_KEY = '';
      config.SONARR4K_API_KEY = '';
    }

    return config;
  }, [state, effectiveEnableSeerr, effectiveEnablePulsarr]);

  const agentPluginIntegrations = useMemo(
    () =>
      [state.installHermesPlugin && 'hermes', state.installOpenClawPlugin && 'openclaw'].filter(Boolean) as Array<
        'hermes' | 'openclaw'
      >,
    [state.installHermesPlugin, state.installOpenClawPlugin]
  );

  const reviewItems = useMemo(
    () => [
      ['Media library', state.mediaRoot],
      ['Music library', state.musicRoot],
      ['Downloads', state.downloadsRoot],
      ['Backups', state.backupRoot],
      ['Plex', state.plexInstallMode],
      ['Jellyfin', state.jellyfinInstallMode],
      [
        'Libraries',
        [
          state.enableMovies && 'Movies',
          state.enableTvShows && 'TV Shows',
          state.enableLidarr && 'Music',
          state.enableBookOrbit && 'Books'
        ]
          .filter(Boolean)
          .join(', ') || 'None'
      ],
      [
        'Requests',
        state.enableRequestManagement
          ? [effectiveEnableSeerr && 'Seerr', effectiveEnablePulsarr && 'Pulsarr'].filter(Boolean).join(', ') || 'None'
          : 'Disabled'
      ],
      [
        'Movie profile',
        state.enable4kServarr
          ? `${mediaProfileName(state.movieProfilePreset, 'hd')} / ${mediaProfileName(state.movie4kProfilePreset, '4k')}`
          : mediaProfileName(state.movieProfilePreset, 'hd')
      ],
      [
        'TV profile',
        state.enable4kServarr
          ? `${mediaProfileName(state.tvProfilePreset, 'hd')} / ${mediaProfileName(state.tv4kProfilePreset, '4k')}`
          : mediaProfileName(state.tvProfilePreset, 'hd')
      ],
      ['Music profile', musicProfileName(state.musicProfilePreset)],
      ['Database mode', state.databaseMode === 'postgres' ? 'Shared Postgres' : 'App defaults'],
      ['Torrent client', state.preferredTorrentClient],
      ['Startup', state.installStartup ? 'Enable startup automation' : 'Manual start'],
      ['Backup automation', state.installBackup ? 'Install weekly Sunday backups' : 'Disabled'],
      ['Updates', state.installUpdates ? 'Enable weekly update automation' : 'Manual updates'],
      ['Agent plugins', agentPluginIntegrations.length ? agentPluginIntegrations.join(', ') : 'None']
    ],
    [state, agentPluginIntegrations]
  );

  function update<K extends keyof SetupState>(key: K, value: SetupState[K]) {
    setState((currentState) => ({ ...currentState, [key]: value }));
  }

  async function saveSetup({
    loadingMessage = 'Saving setup choices...',
    successMessage = 'Setup choices saved.'
  }: {
    loadingMessage?: string;
    successMessage?: string;
  } = {}) {
    if (passwordValidationMessage) {
      setMessage(passwordValidationMessage);
      toast.error(passwordValidationMessage);
      return false;
    }

    setMessage(loadingMessage);
    const toastId = toast.loading(loadingMessage);
    const response = await stackarrFetch('/api/v1/config/stackarr', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        config: setupConfig,
        settings: { setup: { onboardingComplete: true, installMode: 'fresh' } }
      })
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage =
        typeof body.error === 'string'
          ? body.error
          : typeof body.message === 'string'
            ? body.message
            : 'Setup save failed.';
      setMessage(errorMessage);
      toast.error(errorMessage, { id: toastId });
      return false;
    }

    storeStackarrApiKeyFromBody(body);
    setMessage(successMessage);
    toast.success(successMessage, { id: toastId });
    return true;
  }

  async function startSetup() {
    setSetupBusy(true);
    setSetupTaskId('');

    const saved = await saveSetup({
      loadingMessage: 'Saving setup choices...',
      successMessage: 'Setup choices saved. Starting Stackarr setup...'
    });

    if (!saved) {
      setSetupBusy(false);
      return;
    }

    setMessage('Queueing initial setup...');
    const toastId = toast.loading('Queueing initial setup...');
    const response = await stackarrFetch('/api/v1/onboarding/fresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        confirmed: true,
        configureSeerr: effectiveEnableSeerr && state.configureSeerr,
        installStartup: state.installStartup,
        installBackup: state.installBackup,
        installUpdates: state.installUpdates,
        agentPluginIntegrations
      })
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = typeof body.message === 'string' ? body.message : 'Initial setup could not be queued.';
      setMessage(errorMessage);
      toast.error(errorMessage, { id: toastId });
      setSetupBusy(false);
      return;
    }

    const nextTaskId = typeof body.id === 'string' ? body.id : '';
    const nextMessage =
      'Initial setup queued. Stackarr will download images, start containers, and configure services.';
    setSetupTaskId(nextTaskId);
    setMessage(nextMessage);
    toast.success(nextMessage, { id: toastId });
    setSetupBusy(false);
  }

  async function restoreBackup() {
    if (!restoreFile) {
      setRestoreMessage('Choose a Stackarr backup archive first.');
      toast.error('Choose a Stackarr backup archive first.');
      return;
    }

    setRestoreMessage('Queueing restore...');
    const toastId = toast.loading('Queueing restore...');
    const form = new FormData();
    form.set('archive', restoreFile);
    form.set('restorePostgres', String(restorePostgres));
    form.set('restoreNativePlex', String(restoreNativePlex));
    form.set('restorePlexPreferences', String(restorePlexPreferences));
    form.set('forceConfig', 'true');

    const response = await stackarrFetch('/api/v1/onboarding/restore', {
      method: 'POST',
      body: form
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = typeof body.message === 'string' ? body.message : 'Restore could not be queued.';
      setRestoreMessage(errorMessage);
      toast.error(errorMessage, { id: toastId });
      return;
    }

    const nextMessage = `Restore queued as task ${body.id}.`;
    setRestoreMessage(nextMessage);
    toast.success(nextMessage, { id: toastId });
  }

  async function previewMigration() {
    setMigrateMessage('Scanning for supported services...');
    const toastId = toast.loading('Scanning for supported services...');
    const response = await stackarrFetch('/api/v1/onboarding/migrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dryRun: true,
        sourceRoot: migrateSourceRoot || undefined,
        stopSourceContainers: migrateStopSourceContainers
      })
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = typeof body.message === 'string' ? body.message : 'Migration scan failed.';
      setMigrateMessage(errorMessage);
      toast.error(errorMessage, { id: toastId });
      return;
    }

    setMigratePlan(String(body.stdout ?? ''));
    setMigrateMessage('Migration plan ready.');
    toast.success('Migration plan ready.', { id: toastId });
  }

  async function runMigration() {
    setMigrateMessage('Queueing migration...');
    const toastId = toast.loading('Queueing migration...');
    const response = await stackarrFetch('/api/v1/onboarding/migrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dryRun: false,
        confirmed: true,
        sourceRoot: migrateSourceRoot || undefined,
        stopSourceContainers: migrateStopSourceContainers
      })
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage = typeof body.message === 'string' ? body.message : 'Migration could not be queued.';
      setMigrateMessage(errorMessage);
      toast.error(errorMessage, { id: toastId });
      return;
    }

    const nextMessage = `Migration queued as task ${body.id}.`;
    setMigrateMessage(nextMessage);
    toast.success(nextMessage, { id: toastId });
  }

  return (
    <div className={styles.wizard}>
      <ol className={styles.steps}>
        {steps.map((item, index) => (
          <li key={item} className={index === step ? styles.active : index < step ? styles.done : ''}>
            {item}
          </li>
        ))}
      </ol>

      <section className={styles.panel}>
        <h2>{current}</h2>
        {current === 'Welcome' && (
          <div className={styles.modeStack}>
            <div className={styles.modeChoices}>
              <ModeChoice
                checked={setupMode === 'fresh'}
                label="Set Up From Scratch"
                description="Choose paths, services, accounts, automation, and presets for a new Stackarr stack."
                onChange={() => setSetupMode('fresh')}
              />
              <ModeChoice
                checked={setupMode === 'restore'}
                label="Restore From Backup"
                description="Upload a Stackarr backup archive and rebuild the previous config, state, and databases."
                onChange={() => setSetupMode('restore')}
              />
              <ModeChoice
                checked={setupMode === 'migrate'}
                label="Migrate Current Stack"
                description="Find supported existing services and copy their config/database state into Stackarr."
                onChange={() => setSetupMode('migrate')}
              />
            </div>

            {setupMode === 'restore' && (
              <div className={styles.restorePanel}>
                <label>
                  Backup Archive
                  <input
                    accept=".tar.gz,.tgz,.zip,application/gzip,application/zip"
                    type="file"
                    onChange={(event) => setRestoreFile(event.target.files?.[0] ?? null)}
                  />
                </label>
                <div className={styles.checks}>
                  <label>
                    <input
                      type="checkbox"
                      checked={restorePostgres}
                      onChange={(event) => setRestorePostgres(event.target.checked)}
                    />{' '}
                    Restore shared Postgres dumps
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={restoreNativePlex}
                      onChange={(event) => setRestoreNativePlex(event.target.checked)}
                    />{' '}
                    Restore native Plex config
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={restorePlexPreferences}
                      onChange={(event) => setRestorePlexPreferences(event.target.checked)}
                    />{' '}
                    Restore native macOS Plex preferences
                  </label>
                </div>
                <button className={styles.primary} onClick={restoreBackup} type="button">
                  Restore Backup
                </button>
                {restoreMessage && <p className={styles.message}>{restoreMessage}</p>}
              </div>
            )}

            {setupMode === 'migrate' && (
              <div className={styles.restorePanel}>
                <label>
                  Optional Source Root
                  <PathInput value={migrateSourceRoot} onChange={setMigrateSourceRoot} />
                </label>
                <div className={styles.checks}>
                  <label>
                    <input
                      type="checkbox"
                      checked={migrateStopSourceContainers}
                      onChange={(event) => setMigrateStopSourceContainers(event.target.checked)}
                    />{' '}
                    Stop source containers while copying
                  </label>
                </div>
                <div className={styles.actionRow}>
                  <button onClick={previewMigration} type="button">
                    Preview Migration
                  </button>
                  <button className={styles.primary} onClick={runMigration} type="button">
                    Start Migration
                  </button>
                </div>
                {migratePlan && <pre className={styles.planOutput}>{migratePlan}</pre>}
                {migrateMessage && <p className={styles.message}>{migrateMessage}</p>}
              </div>
            )}
          </div>
        )}
        {current === 'Storage Paths' && (
          <div className={styles.form}>
            <label>
              Media Root
              <PathInput value={state.mediaRoot} onChange={(value) => update('mediaRoot', value)} />
            </label>
            <label>
              Music Root
              <PathInput value={state.musicRoot} onChange={(value) => update('musicRoot', value)} />
            </label>
            <label>
              Downloads Root
              <PathInput value={state.downloadsRoot} onChange={(value) => update('downloadsRoot', value)} />
            </label>
            <label>
              Backup Root
              <PathInput value={state.backupRoot} onChange={(value) => update('backupRoot', value)} />
            </label>
          </div>
        )}
        {current === 'Media Servers' && (
          <div className={styles.form}>
            <label>
              Plex
              <select value={state.plexInstallMode} onChange={(event) => update('plexInstallMode', event.target.value)}>
                <option value="native">Native macOS</option>
                <option value="docker">Docker</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <label>
              Jellyfin
              <select
                value={state.jellyfinInstallMode}
                onChange={(event) => update('jellyfinInstallMode', event.target.value)}
              >
                <option value="disabled">Disabled</option>
                <option value="native">Native macOS</option>
                <option value="docker">Docker</option>
              </select>
            </label>
          </div>
        )}
        {current === 'Media Requests' && (
          <div className={styles.requestManagement}>
            <label className={styles.requestToggle}>
              <input
                type="checkbox"
                checked={state.enableRequestManagement}
                onChange={(event) => update('enableRequestManagement', event.target.checked)}
              />
              <span>
                <strong>Do you want media request management?</strong>
              </span>
            </label>
            {state.enableRequestManagement && (
              <div className={styles.serviceChoices}>
                <ServiceChoice
                  checked={state.enableSeerr}
                  label="Seerr Requests"
                  description="Optional request portal for Jellyfin or manual request workflows."
                  onChange={(value) => update('enableSeerr', value)}
                />
                {state.enableSeerr && (
                  <ServiceChoice
                    checked={state.configureSeerr}
                    label="Wire Seerr Arr Services"
                    description="Opt-in automation that adds Radarr and Sonarr services inside Seerr."
                    onChange={(value) => update('configureSeerr', value)}
                  />
                )}
                {!jellyfinEnabled && (
                  <ServiceChoice
                    checked={state.enablePulsarr}
                    label="Pulsarr Watchlists"
                    description="Plex watchlist automation that routes saved items into the configured Arr apps."
                    onChange={(value) => update('enablePulsarr', value)}
                  />
                )}
              </div>
            )}
          </div>
        )}
        {current === 'Stack Services' && (
          <div className={styles.serviceChoices}>
            <ServiceChoice
              checked={state.enableMovies}
              label="Movies (Radarr)"
              description="Movie automation. Stackarr will configure Radarr and sync matching indexers through Prowlarr."
              onChange={(value) => update('enableMovies', value)}
            />
            <ServiceChoice
              checked={state.enableTvShows}
              label="TV Shows (Sonarr)"
              description="TV automation. Stackarr will configure Sonarr and sync matching indexers through Prowlarr."
              onChange={(value) => update('enableTvShows', value)}
            />
            <ServiceChoice
              checked={state.enableLidarr}
              label="Music (Lidarr)"
              description="Music automation with lossless-preferred and lossy 256+ profiles."
              onChange={(value) => update('enableLidarr', value)}
            />
            <ServiceChoice
              checked={state.enableBookOrbit}
              label="Books (BookOrbit)"
              description="Book automation and library management (Kobo sync, etc). Optional service."
              onChange={(value) => update('enableBookOrbit', value)}
            />
            <ServiceChoice
              checked={state.enable4kServarr}
              label="Separate Radarr/Sonarr 4K"
              description="Dedicated 4K movie and TV apps keep UHD requests, profiles, and upgrades isolated from HD libraries."
              onChange={(value) => update('enable4kServarr', value)}
            />
            <ServiceChoice
              checked={state.enableBazarr}
              label="Bazarr Subtitles"
              description="Subtitle management for imported movie and TV libraries."
              onChange={(value) => update('enableBazarr', value)}
            />
            <ServiceChoice
              checked={state.enableTinyMediaManager}
              label="TinyMediaManager"
              description="Metadata and renaming companion for local movie and TV folders."
              onChange={(value) => update('enableTinyMediaManager', value)}
            />
            <ServiceChoice
              checked={state.enableRecyclarr}
              label="Recyclarr Profiles"
              description="Keeps Arr quality profiles aligned with Stackarr's opinionated defaults."
              onChange={(value) => update('enableRecyclarr', value)}
            />
            <ServiceChoice
              checked={state.enableFlaresolverr}
              label="FlareSolverr"
              description="Indexer helper for sites that require browser-style challenge handling."
              onChange={(value) => update('enableFlaresolverr', value)}
            />
            <ServiceChoice
              checked={state.enableTidarr}
              label="Tidarr"
              description="Tidal helper for music workflows that need it."
              onChange={(value) => update('enableTidarr', value)}
            />
          </div>
        )}
        {current === 'Account' && (
          <div className={styles.form}>
            <p>
              Stackarr uses these shared credentials for first-run setup of services that support local admin accounts.
              Pulsarr uses the email for its admin account; leave it blank to let setup try the signed-in Plex account
              email first.
            </p>
            <label>
              Global Username
              <input
                autoComplete="username"
                value={state.globalUsername}
                onChange={(event) => update('globalUsername', event.target.value)}
              />
            </label>
            <label>
              Global Password
              <input
                autoComplete="new-password"
                aria-invalid={Boolean(passwordValidationMessage)}
                pattern="[A-Za-z0-9._-]{8,}"
                type="password"
                value={state.globalPassword}
                onChange={(event) => update('globalPassword', event.target.value)}
                title={`Use at least ${portablePasswordMinimumLength} characters: ${portablePasswordDescription}.`}
              />
              {passwordValidationMessage && <small>{passwordValidationMessage}</small>}
            </label>
            <label>
              Admin Email
              <input
                autoComplete="email"
                type="email"
                value={state.globalEmail}
                onChange={(event) => update('globalEmail', event.target.value)}
                placeholder="Use Plex account email when blank"
              />
            </label>
          </div>
        )}
        {current === 'Database' && (
          <div className={styles.form}>
            <label>
              Database Mode
              <select value={state.databaseMode} onChange={(event) => update('databaseMode', event.target.value)}>
                <option value="app-default">App defaults</option>
                <option value="postgres">Shared Postgres</option>
              </select>
            </label>
            <p>
              BookOrbit uses Postgres when enabled. The shared Postgres option moves supported Stackarr-managed apps
              onto the database container as a blanket advanced setup choice.
            </p>
          </div>
        )}
        {current === 'Torrent Client' && (
          <div className={styles.segmented}>
            <button
              className={state.preferredTorrentClient === 'transmission' ? styles.selected : ''}
              onClick={() => update('preferredTorrentClient', 'transmission')}
              type="button"
            >
              Transmission
            </button>
            <button
              className={state.preferredTorrentClient === 'qbittorrent' ? styles.selected : ''}
              onClick={() => update('preferredTorrentClient', 'qbittorrent')}
              type="button"
            >
              qBittorrent
            </button>
          </div>
        )}
        {current === 'Automation' && (
          <div className={styles.checks}>
            <label>
              <input
                type="checkbox"
                checked={state.installStartup}
                onChange={(event) => update('installStartup', event.target.checked)}
              />{' '}
              Startup automation
            </label>
            <label>
              <input
                type="checkbox"
                checked={state.installBackup}
                onChange={(event) => update('installBackup', event.target.checked)}
              />{' '}
              Weekly backup automation
            </label>
            <label>
              <input
                type="checkbox"
                checked={state.installUpdates}
                onChange={(event) => update('installUpdates', event.target.checked)}
              />{' '}
              Weekly update automation
            </label>
          </div>
        )}
        {current === 'Agent Plugins' && (
          <div className={styles.checks}>
            <p>
              Optional local agent integrations use <code>stackarr mcp serve</code>, so they stay tied to this Stackarr
              install instead of hardcoded repo paths.
            </p>
            <label>
              <input
                type="checkbox"
                checked={state.installHermesPlugin}
                onChange={(event) => update('installHermesPlugin', event.target.checked)}
              />{' '}
              Install and enable Hermes plugin
            </label>
            <label>
              <input
                type="checkbox"
                checked={state.installOpenClawPlugin}
                onChange={(event) => update('installOpenClawPlugin', event.target.checked)}
              />{' '}
              Prepare OpenClaw MCP plugin bundle
            </label>
          </div>
        )}
        {current === 'Presets' && (
          <div className={styles.form}>
            <p>
              Profile presets are saved as runtime settings and translated into Recyclarr configs for Radarr/Sonarr
              during configure. Lidarr is configured directly through its API.
            </p>
            <label>
              Movie Profile
              <select
                value={state.movieProfilePreset}
                onChange={(event) => update('movieProfilePreset', event.target.value)}
              >
                <option value="lite">HD Lite</option>
                <option value="balanced">HD</option>
              </select>
            </label>
            {state.enable4kServarr && (
              <label>
                4K Movie Profile
                <select
                  value={state.movie4kProfilePreset}
                  onChange={(event) => update('movie4kProfilePreset', event.target.value)}
                >
                  <option value="lite">4K Lite</option>
                  <option value="balanced">4K</option>
                </select>
              </label>
            )}
            <label>
              TV Profile
              <select value={state.tvProfilePreset} onChange={(event) => update('tvProfilePreset', event.target.value)}>
                <option value="lite">HD Lite</option>
                <option value="balanced">HD</option>
              </select>
            </label>
            {state.enable4kServarr && (
              <label>
                4K TV Profile
                <select
                  value={state.tv4kProfilePreset}
                  onChange={(event) => update('tv4kProfilePreset', event.target.value)}
                >
                  <option value="lite">4K Lite</option>
                  <option value="balanced">4K</option>
                </select>
              </label>
            )}
            <label>
              Music Profile
              <select
                value={state.musicProfilePreset}
                onChange={(event) => update('musicProfilePreset', event.target.value)}
              >
                <option value="lossless">Lossless</option>
                <option value="lossy">Lossy 256+</option>
              </select>
            </label>
          </div>
        )}
        {current === 'Review' && (
          <dl className={styles.review}>
            {reviewItems.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
        {current === 'Run Setup' && (
          <div className={styles.runSetup}>
            <p>
              Start setup to save these choices, download any missing Docker images, start the managed containers,
              configure service credentials, and apply Stackarr presets.
            </p>
            <div className={styles.actionRow}>
              <button className={styles.primary} disabled={setupBusy} onClick={startSetup} type="button">
                {setupBusy ? 'Starting...' : 'Start Setup'}
              </button>
              <button disabled={setupBusy} onClick={() => void saveSetup()} type="button">
                Save Only
              </button>
            </div>
            {message && <p className={styles.message}>{message}</p>}
            {setupTask && (
              <div className={styles.setupProgress}>
                <TaskProgressView task={setupTask} />
                {setupTask.output && <pre className={styles.planOutput}>{setupTask.output}</pre>}
              </div>
            )}
          </div>
        )}
      </section>

      <div className={styles.footer}>
        <button disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))} type="button">
          Back
        </button>
        <button
          disabled={step === steps.length - 1 || (step === 0 && setupMode !== 'fresh')}
          onClick={() => setStep((value) => Math.min(steps.length - 1, value + 1))}
          type="button"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function ModeChoice({
  checked,
  label,
  description,
  onChange
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: () => void;
}) {
  return (
    <label className={styles.serviceChoice}>
      <input type="radio" checked={checked} onChange={onChange} name="setupMode" />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

function mediaProfileName(preset: string, resolution: 'hd' | '4k') {
  if (preset === 'balanced') {
    return resolution === '4k' ? '4K' : 'HD';
  }

  return resolution === '4k' ? '4K Lite' : 'HD Lite';
}

function musicProfileName(preset: string) {
  return preset === 'lossy' ? 'Lossy 256+' : 'Lossless';
}

function validateRequiredPortablePassword(password: string) {
  if (!password) {
    return 'Global password is required before Stackarr can configure managed services.';
  }

  if (password.length < portablePasswordMinimumLength) {
    return `Global password must be at least ${portablePasswordMinimumLength} characters.`;
  }

  if (!portablePasswordPattern.test(password)) {
    return `Global password may only use ${portablePasswordDescription}.`;
  }

  return '';
}

function ServiceChoice({
  checked,
  label,
  description,
  onChange
}: {
  checked: boolean;
  label: string;
  description: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={styles.serviceChoice}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}

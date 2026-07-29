'use client';

import type { StackarrEnv, StackarrSettings } from '@stackarr/core';
import {
  accountUsernameMaximumLength,
  accountUsernameValidationError,
  portablePasswordMaximumLength,
  portablePasswordMinimumLength,
  portablePasswordValidationError
} from '@stackarr/core/passwordPolicy';
import { Button, icons, Label, Switch } from '@stackarr/ui';
import { applyStackarrDocumentTheme } from '@stackarr/ui/theme-provider';
import { toast } from '@stackarr/ui/toast';
import type React from 'react';
import { useId, useState } from 'react';
import { stackarrFetch, storeStackarrApiKeyFromBody } from './clientApi';
import { PathInput } from './PathPicker';
import styles from './SettingsEditor.module.css';

type Props = {
  section: string;
  env: StackarrEnv;
  settings: StackarrSettings;
};

type CloudflareRoute = {
  hostname: string;
  service: string;
  access?: boolean;
};

type SelectOption = string | { value: string; label: string };
type SecurityCredentialType = 'access' | 'database';
type SecurityServiceTarget = {
  id: string;
  label: string;
  description: string;
  accessKeys?: string[];
  databaseKeys?: string[];
};

const storageEnvKeys = [
  'MEDIA_ROOT',
  'MUSIC_ROOT',
  'DOWNLOADS_ROOT',
  'BACKUP_ROOT',
  'GAMES_ROOT',
  'ROMM_LIBRARY_ROOT'
] as const;
const mediaProfilePresetOptions = ['lite', 'balanced'];
const musicProfilePresetOptions = ['lossless', 'lossy'];
const themeOptions: Array<StackarrSettings['ui']['theme']> = ['light', 'dark', 'system'];
const globalDatabasePasswordKeys = [
  'DATABASE_SUPERUSER_PASSWORD',
  'STACKARR_POSTGRES_PASSWORD',
  'BOOKORBIT_POSTGRES_PASSWORD',
  'IMMICH_DB_PASSWORD',
  'ROMM_DB_PASSWORD',
  'SEERR_POSTGRES_PASSWORD',
  'PULSARR_POSTGRES_PASSWORD',
  'TRACEARR_DB_PASSWORD',
  'TRACEARR_POSTGRES_PASSWORD',
  'BAZARR_POSTGRES_PASSWORD',
  'PROWLARR_POSTGRES_PASSWORD',
  'RADARR_POSTGRES_PASSWORD',
  'RADARR4K_POSTGRES_PASSWORD',
  'SONARR_POSTGRES_PASSWORD',
  'SONARR4K_POSTGRES_PASSWORD',
  'LIDARR_POSTGRES_PASSWORD'
];
const accountPasswordKeys = [
  'PASSWORD',
  'TRANSMISSION_PASSWORD',
  'QBITTORRENT_PASSWORD',
  'PROWLARR_PASSWORD',
  'RADARR_PASSWORD',
  'RADARR4K_PASSWORD',
  'SONARR_PASSWORD',
  'SONARR4K_PASSWORD',
  'LIDARR_PASSWORD',
  'BAZARR_PASSWORD',
  'PULSARR_PASSWORD',
  'BOOKORBIT_PASSWORD',
  'TINYMEDIAMANAGER_PASSWORD',
  'TRACEARR_ADMIN_PASSWORD'
];
const securityServices: SecurityServiceTarget[] = [
  {
    id: 'all-postgres',
    label: 'All managed Postgres roles',
    description: 'Every managed Postgres role password, including the superuser and app roles.',
    databaseKeys: globalDatabasePasswordKeys
  },
  {
    id: 'radarr',
    label: 'Radarr',
    description: 'Movie app UI password and its Postgres role.',
    accessKeys: ['RADARR_PASSWORD'],
    databaseKeys: ['RADARR_POSTGRES_PASSWORD']
  },
  {
    id: 'radarr4k',
    label: 'Radarr 4K',
    description: '4K movie app UI password and its Postgres role.',
    accessKeys: ['RADARR4K_PASSWORD'],
    databaseKeys: ['RADARR4K_POSTGRES_PASSWORD']
  },
  {
    id: 'sonarr',
    label: 'Sonarr',
    description: 'TV app UI password and its Postgres role.',
    accessKeys: ['SONARR_PASSWORD'],
    databaseKeys: ['SONARR_POSTGRES_PASSWORD']
  },
  {
    id: 'sonarr4k',
    label: 'Sonarr 4K',
    description: '4K TV app UI password and its Postgres role.',
    accessKeys: ['SONARR4K_PASSWORD'],
    databaseKeys: ['SONARR4K_POSTGRES_PASSWORD']
  },
  {
    id: 'prowlarr',
    label: 'Prowlarr',
    description: 'Indexer app UI password and its Postgres role.',
    accessKeys: ['PROWLARR_PASSWORD'],
    databaseKeys: ['PROWLARR_POSTGRES_PASSWORD']
  },
  {
    id: 'lidarr',
    label: 'Lidarr',
    description: 'Music app UI password and its Postgres role.',
    accessKeys: ['LIDARR_PASSWORD'],
    databaseKeys: ['LIDARR_POSTGRES_PASSWORD']
  },
  {
    id: 'bazarr',
    label: 'Bazarr',
    description: 'Subtitle app UI password and its Postgres role.',
    accessKeys: ['BAZARR_PASSWORD'],
    databaseKeys: ['BAZARR_POSTGRES_PASSWORD']
  },
  {
    id: 'transmission',
    label: 'Transmission',
    description: 'Torrent client RPC and web UI password.',
    accessKeys: ['TRANSMISSION_PASSWORD']
  },
  {
    id: 'qbittorrent',
    label: 'qBittorrent',
    description: 'Torrent client web UI password.',
    accessKeys: ['QBITTORRENT_PASSWORD']
  },
  {
    id: 'tinymediamanager',
    label: 'TinyMediaManager',
    description: 'TinyMediaManager web/VNC password.',
    accessKeys: ['TINYMEDIAMANAGER_PASSWORD']
  },
  {
    id: 'bookorbit',
    label: 'BookOrbit',
    description: 'BookOrbit admin password and its Postgres role.',
    accessKeys: ['BOOKORBIT_PASSWORD'],
    databaseKeys: ['BOOKORBIT_POSTGRES_PASSWORD']
  },
  {
    id: 'pulsarr',
    label: 'Pulsarr',
    description: 'Pulsarr admin password and its Postgres role.',
    accessKeys: ['PULSARR_PASSWORD'],
    databaseKeys: ['PULSARR_POSTGRES_PASSWORD']
  },
  {
    id: 'seerr',
    label: 'Seerr',
    description: 'Seerr Postgres role password.',
    databaseKeys: ['SEERR_POSTGRES_PASSWORD']
  },
  {
    id: 'tracearr',
    label: 'Tracearr',
    description: 'Tracearr owner password and shared-Postgres role password.',
    accessKeys: ['TRACEARR_ADMIN_PASSWORD'],
    databaseKeys: ['TRACEARR_DB_PASSWORD', 'TRACEARR_POSTGRES_PASSWORD']
  },
  {
    id: 'immich',
    label: 'Immich',
    description: 'Immich shared-Postgres role password.',
    databaseKeys: ['IMMICH_DB_PASSWORD']
  },
  {
    id: 'romm',
    label: 'RomM',
    description: 'RomM shared-Postgres role, first-run admin, and app secret credentials.',
    databaseKeys: ['ROMM_DB_PASSWORD'],
    accessKeys: ['ROMM_ADMIN_PASSWORD', 'ROMM_AUTH_SECRET_KEY']
  },
  {
    id: 'stackarr-postgres',
    label: 'Stackarr Postgres',
    description: 'Stackarr application database role password.',
    databaseKeys: ['STACKARR_POSTGRES_PASSWORD']
  },
  {
    id: 'postgres-superuser',
    label: 'Postgres superuser',
    description: 'Shared Postgres superuser password.',
    databaseKeys: ['DATABASE_SUPERUSER_PASSWORD']
  }
];
const cloudflareServiceOptions = [
  'pulsarr',
  'maintainerr',
  'tracearr',
  'bookorbit',
  'immich',
  'romm',
  'questarr',
  'stackarr',
  'seerr',
  'transmission',
  'qbittorrent',
  'plex',
  'jellyfin',
  'tinymm',
  'radarr',
  'sonarr',
  'lidarr',
  'prowlarr',
  'bazarr'
];
const EyeIcon = icons.eye;
const KeyIcon = icons.key;
const LockIcon = icons.lock;

function mediaProfileName(preset: string, resolution: 'hd' | '4k') {
  if (preset === 'balanced') {
    return resolution === '4k' ? '4K' : 'HD';
  }

  return resolution === '4k' ? '4K Lite' : 'HD Lite';
}

function musicProfileName(preset: string) {
  return preset === 'lossy' ? 'Lossy 256+' : 'Lossless';
}

export function SettingsEditor({ section, env, settings }: Props) {
  const [draftEnv, setDraftEnv] = useState(env);
  const [draftSettings, setDraftSettings] = useState(settings);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [accountState, setAccountState] = useState<'idle' | 'saving' | 'queued' | 'error'>('idle');
  const [rotateState, setRotateState] = useState<'idle' | 'saving' | 'queued' | 'error'>('idle');
  const [cloudflareApplyState, setCloudflareApplyState] = useState<'idle' | 'saving' | 'queued' | 'error'>('idle');
  const [securityState, setSecurityState] = useState<'idle' | 'saving' | 'queued' | 'error'>('idle');
  const [generalCurrentPassword, setGeneralCurrentPassword] = useState('');
  const [accountCurrentPassword, setAccountCurrentPassword] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountPasswordConfirm, setAccountPasswordConfirm] = useState('');
  const [securityServiceId, setSecurityServiceId] = useState('');
  const [securityCredentialType, setSecurityCredentialType] = useState<SecurityCredentialType>('access');
  const [serviceCurrentPassword, setServiceCurrentPassword] = useState('');
  const [servicePassword, setServicePassword] = useState('');
  const [servicePasswordConfirm, setServicePasswordConfirm] = useState('');
  const [telemetryPreview, setTelemetryPreview] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState('');

  function envValue(key: string) {
    return draftEnv[key] ?? '';
  }

  function envBool(key: string, fallback = true) {
    const value = envValue(key);

    if (!value) {
      return fallback;
    }

    return /^(1|true|yes|on)$/i.test(value);
  }

  function updateEnv(key: string, value: string) {
    setDraftEnv((current) => ({ ...current, [key]: value }));
  }

  function updateEnvBool(key: string, value: boolean) {
    updateEnv(key, value ? 'true' : 'false');
  }

  function updateProfilePreset(
    presetKey: keyof StackarrSettings['profiles'],
    envPresetKey: string,
    profileKey: keyof StackarrSettings['profiles'],
    envProfileKey: string,
    value: string,
    defaultName: string
  ) {
    updateEnv(envPresetKey, value);
    updateEnv(envProfileKey, defaultName);
    updateSettings('profiles', presetKey, value as never);
    updateSettings('profiles', profileKey, defaultName as never);
  }

  function updateProfileName(key: keyof StackarrSettings['profiles'], envKey: string, value: string) {
    updateEnv(envKey, value);
    updateSettings('profiles', key, value as never);
  }

  const separate4kEnabled = envBool('ENABLE_4K_SERVARR', draftSettings.profiles.preferSeparateHd4kInstances);
  const telemetryFeatureEnabled = true;
  const advancedEnvKeys = Object.keys(draftEnv)
    .filter((key) => /^[A-Z][A-Z0-9_]*$/.test(key))
    .filter((key) => telemetryFeatureEnabled || !key.startsWith('STACKARR_TELEMETRY_'))
    .sort();
  const passwordValidationMessage = firstPortablePasswordValidationError(draftEnv, env);
  const usernameValidationMessage = accountUsernameValidationError(envValue('USERNAME'), 'Username') ?? '';
  const protectedEnvPasswordChanged = protectedEnvChangeRequiresCurrentPassword(draftEnv, env);
  const cloudflareRoutes = parseCloudflareRoutes(envValue('CLOUDFLARE_TUNNEL_ROUTES'));
  const selectedSecurityService = securityServices.find((service) => service.id === securityServiceId);
  const selectedSecurityCredentialOptions = selectedSecurityService
    ? securityCredentialOptions(selectedSecurityService)
    : [];
  const selectedSecurityKeys =
    selectedSecurityService && securityCredentialType === 'database'
      ? (selectedSecurityService.databaseKeys ?? [])
      : (selectedSecurityService?.accessKeys ?? []);

  function updateSettings<T extends keyof StackarrSettings, K extends keyof StackarrSettings[T]>(
    group: T,
    key: K,
    value: StackarrSettings[T][K]
  ) {
    if (group === 'ui' && key === 'theme') {
      applyStackarrDocumentTheme(value as StackarrSettings['ui']['theme']);
    }

    setDraftSettings((current) => ({
      ...current,
      [group]: {
        ...current[group],
        [key]: value
      }
    }));
  }

  async function saveConfig(
    config: StackarrEnv = draftEnv,
    nextSettings: StackarrSettings = draftSettings,
    currentPassword?: string
  ) {
    const response = await stackarrFetch('/api/v1/config/stackarr', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        config,
        settings: nextSettings,
        confirmTelemetry: nextSettings.telemetry.enabled && !settings.telemetry.enabled,
        ...(currentPassword !== undefined ? { currentPassword } : {})
      })
    });
    const body = await response.json().catch(() => ({}));
    storeStackarrApiKeyFromBody(body);

    return { response, body };
  }

  async function save() {
    if (usernameValidationMessage || passwordValidationMessage) {
      const validationMessage = usernameValidationMessage || passwordValidationMessage;
      setState('error');
      setMessage(validationMessage);
      toast.error(validationMessage);
      return;
    }

    const currentPasswordValidation = protectedEnvPasswordChanged
      ? currentAdminPasswordError(generalCurrentPassword, true)
      : '';
    if (currentPasswordValidation) {
      setState('error');
      setMessage(currentPasswordValidation);
      toast.error(currentPasswordValidation);
      return;
    }

    setState('saving');
    setMessage('');
    const toastId = toast.loading('Saving settings...');
    const storageChanged = storageEnvKeys.some((key) => envValue(key) !== (env[key] ?? ''));
    const { response, body } = await saveConfig(
      draftEnv,
      draftSettings,
      protectedEnvPasswordChanged ? generalCurrentPassword : undefined
    );

    setState(response.ok ? 'saved' : 'error');
    if (response.ok) {
      setGeneralCurrentPassword('');
      let telemetryMessage = '';
      if (draftSettings.telemetry.enabled && !settings.telemetry.enabled) {
        const heartbeat = await stackarrFetch('/api/v1/telemetry/heartbeat', { method: 'POST' });
        telemetryMessage = heartbeat.ok
          ? ' Anonymous usage data is enabled and the first heartbeat was sent.'
          : ' Anonymous usage data is enabled; the first heartbeat will retry automatically.';
      }
      if (storageChanged) {
        const applyResponse = await stackarrFetch('/api/v1/command', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'StackStart', confirmed: true })
        });
        const nextMessage = applyResponse.ok
          ? 'Saved. Storage mounts apply queued.'
          : 'Saved. Storage mounts need apply from System.';

        const combinedMessage = `${nextMessage}${portlessHostActionMessage(body.portlessHostAction)}${telemetryMessage}`;
        setMessage(combinedMessage);
        toast[applyResponse.ok ? 'success' : 'error'](combinedMessage, { id: toastId });
        return;
      }

      const nextMessage = `Saved${portlessHostActionMessage(body.portlessHostAction)}${telemetryMessage}`;
      setMessage(nextMessage);
      toast.success(nextMessage, { id: toastId });
    } else {
      const errorMessage = typeof body.error === 'string' ? body.error : 'Save failed';
      setMessage(errorMessage);
      toast.error(errorMessage, { id: toastId });
    }
  }

  async function rotateTunnelToken() {
    const confirmed = window.confirm(
      'Rotate the Cloudflare connector credential by recreating the Cloudflare tunnel and saving the new runtime credential?'
    );

    if (!confirmed) {
      return;
    }

    setRotateState('saving');
    setMessage('');
    const toastId = toast.loading('Saving Cloudflare settings...');
    const { response, body } = await saveConfig();

    if (!response.ok) {
      setRotateState('error');
      const errorMessage =
        typeof body.error === 'string' ? body.error : 'Save failed. The connector credential was not rotated.';
      setMessage(errorMessage);
      toast.error(errorMessage, { id: toastId });
      return;
    }

    const rotateResponse = await stackarrFetch('/api/v1/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'CloudflareRotate', confirmed: true })
    });

    setRotateState(rotateResponse.ok ? 'queued' : 'error');
    const nextMessage = rotateResponse.ok
      ? 'Saved. Cloudflare connector credential rotation queued.'
      : 'Saved, but connector credential rotation failed to queue.';
    setMessage(nextMessage);
    toast[rotateResponse.ok ? 'success' : 'error'](nextMessage, { id: toastId });
  }

  async function applyCloudflareRoutes() {
    const publicRoutes = cloudflareRoutes.filter((route) => route.hostname);
    if (draftSettings.connect.warnBeforePublicExposure && publicRoutes.length > 0) {
      const confirmed = window.confirm(
        cloudflareExposureWarning(publicRoutes, envBool('CLOUDFLARE_ACCESS_ENABLED', false))
      );

      if (!confirmed) {
        return;
      }
    }

    setCloudflareApplyState('saving');
    setMessage('');
    const toastId = toast.loading('Saving Cloudflare routes...');
    const { response, body } = await saveConfig();

    if (!response.ok) {
      setCloudflareApplyState('error');
      const errorMessage =
        typeof body.error === 'string' ? body.error : 'Save failed. Cloudflare routes were not applied.';
      setMessage(errorMessage);
      toast.error(errorMessage, { id: toastId });
      return;
    }

    const applyResponse = await stackarrFetch('/api/v1/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'CloudflareApplyRoutes' })
    });

    setCloudflareApplyState(applyResponse.ok ? 'queued' : 'error');
    const nextMessage = applyResponse.ok
      ? 'Saved. Cloudflare route apply queued.'
      : 'Saved, but Cloudflare route apply failed to queue.';
    setMessage(nextMessage);
    toast[applyResponse.ok ? 'success' : 'error'](nextMessage, { id: toastId });
  }

  async function applyAccountSettings() {
    const usernameChanged = envValue('USERNAME') !== (env.USERNAME ?? '');
    const emailChanged = envValue('USER_EMAIL') !== (env.USER_EMAIL ?? '');
    const apiKeyChanged = envValue('STACKARR_API_KEY') !== (env.STACKARR_API_KEY ?? '');
    const passwordChanged = Boolean(accountPassword || accountPasswordConfirm);
    const requiresCurrentPassword = usernameChanged || emailChanged || apiKeyChanged || passwordChanged;
    const validation =
      accountUsernameValidationError(envValue('USERNAME'), 'Username') ||
      currentAdminPasswordError(accountCurrentPassword, requiresCurrentPassword) ||
      (passwordChanged ? passwordConfirmationError('Account password', accountPassword, accountPasswordConfirm) : '') ||
      (!requiresCurrentPassword ? 'No account changes to save.' : '');
    if (validation) {
      setAccountState('error');
      setMessage(validation);
      toast.error(validation);
      return;
    }

    let nextEnv = applyAccountIdentityPatch(draftEnv, env);
    if (passwordChanged) {
      nextEnv = applyPasswordPatch(nextEnv, accountPasswordKeys, accountPassword);
    }

    await saveAccountChange(nextEnv, 'Account settings saved.', accountCurrentPassword);
    setAccountCurrentPassword('');
    setAccountPassword('');
    setAccountPasswordConfirm('');
  }

  async function applyServicePassword() {
    if (!selectedSecurityService || selectedSecurityKeys.length === 0) {
      const validation = 'Choose a service and credential type first.';
      setSecurityState('error');
      setMessage(validation);
      toast.error(validation);
      return;
    }

    const validation =
      currentAdminPasswordError(serviceCurrentPassword, true) ||
      passwordConfirmationError(`${selectedSecurityService.label} password`, servicePassword, servicePasswordConfirm) ||
      (!servicePassword ? `${selectedSecurityService.label} password is required.` : '');
    if (validation) {
      setSecurityState('error');
      setMessage(validation);
      toast.error(validation);
      return;
    }

    const nextEnv = applyPasswordPatch(draftEnv, selectedSecurityKeys, servicePassword);
    if (selectedSecurityKeys.includes('PULSARR_POSTGRES_PASSWORD') && nextEnv.PULSARR_DB_TYPE === 'postgres') {
      nextEnv.PULSARR_DB_PASSWORD = servicePassword;
    }

    await saveSecurityPasswordChange(
      nextEnv,
      `${selectedSecurityService.label} password saved.`,
      serviceCurrentPassword
    );
    setServiceCurrentPassword('');
    setServicePassword('');
    setServicePasswordConfirm('');
  }

  async function saveSecurityPasswordChange(nextEnv: StackarrEnv, savedMessage: string, currentPassword: string) {
    setSecurityState('saving');
    setMessage('');
    const toastId = toast.loading('Saving security settings...');
    const { response, body } = await saveConfig(nextEnv, draftSettings, currentPassword);

    if (!response.ok) {
      setSecurityState('error');
      const errorMessage = typeof body.error === 'string' ? body.error : 'Security settings failed to save.';
      setMessage(errorMessage);
      toast.error(errorMessage, { id: toastId });
      return;
    }

    setDraftEnv(nextEnv);
    const applyResponse = await stackarrFetch('/api/v1/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'SecurityApply', confirmed: true })
    });

    setSecurityState(applyResponse.ok ? 'queued' : 'error');
    const nextMessage = applyResponse.ok
      ? `${savedMessage} Security apply queued.`
      : `${savedMessage} Security apply failed to queue.`;
    setMessage(nextMessage);
    toast[applyResponse.ok ? 'success' : 'error'](nextMessage, { id: toastId });
  }

  async function saveAccountChange(nextEnv: StackarrEnv, savedMessage: string, currentPassword: string) {
    setAccountState('saving');
    setMessage('');
    const toastId = toast.loading('Saving account settings...');
    const { response, body } = await saveConfig(nextEnv, draftSettings, currentPassword);

    if (!response.ok) {
      setAccountState('error');
      const errorMessage = typeof body.error === 'string' ? body.error : 'Account settings failed to save.';
      setMessage(errorMessage);
      toast.error(errorMessage, { id: toastId });
      return;
    }

    setDraftEnv(nextEnv);
    const applyResponse = await stackarrFetch('/api/v1/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'SecurityApply', confirmed: true })
    });

    setAccountState(applyResponse.ok ? 'queued' : 'error');
    const nextMessage = applyResponse.ok
      ? `${savedMessage} Security apply queued.`
      : `${savedMessage} Security apply failed to queue.`;
    setMessage(nextMessage);
    toast[applyResponse.ok ? 'success' : 'error'](nextMessage, { id: toastId });
  }

  function updateSecurityService(value: string) {
    const service = securityServices.find((item) => item.id === value);
    const nextCredentialType = service ? (service.accessKeys?.length ? 'access' : 'database') : 'access';

    setSecurityServiceId(value);
    setSecurityCredentialType(nextCredentialType);
    setServiceCurrentPassword('');
    setServicePassword('');
    setServicePasswordConfirm('');
  }

  function updateCloudflareRoutes(routes: CloudflareRoute[]) {
    const normalized = routes
      .map((route) => ({
        hostname: normalizeHostname(route.hostname),
        service: route.service || 'pulsarr',
        access: route.access ?? defaultCloudflareRouteAccess(route.service)
      }))
      .filter((route) => route.hostname || route.service);

    updateEnv('CLOUDFLARE_TUNNEL_ROUTES', JSON.stringify(normalized));
    updateEnv('CLOUDFLARED_TUNNEL_NAME', envValue('CLOUDFLARED_TUNNEL_NAME') || 'stackarr');
  }

  function updateCloudflareRoute(index: number, patch: Partial<CloudflareRoute>) {
    updateCloudflareRoutes(
      cloudflareRoutes.map((route, routeIndex) => (routeIndex === index ? { ...route, ...patch } : route))
    );
  }

  function addCloudflareRoute() {
    updateCloudflareRoutes([...cloudflareRoutes, { hostname: '', service: 'pulsarr', access: true }]);
  }

  function removeCloudflareRoute(index: number) {
    updateCloudflareRoutes(cloudflareRoutes.filter((_, routeIndex) => routeIndex !== index));
  }

  function updateTelemetryEnabled(value: boolean) {
    updateSettings('telemetry', 'enabled', value);
    updateEnvBool('STACKARR_TELEMETRY_ENABLED', value);
  }

  async function previewTelemetry() {
    const response = await stackarrFetch('/api/v1/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preview: true })
    });
    const body = (await response.json().catch(() => ({}))) as { payload?: unknown };
    setTelemetryPreview(
      body.payload && typeof body.payload === 'object' ? (body.payload as Record<string, unknown>) : {}
    );
  }

  return (
    <div className={styles.editor}>
      {section === 'mediamanagement' && (
        <FormGrid>
          <Path
            label="Media Root"
            value={envValue('MEDIA_ROOT')}
            onChange={(value) => updateEnv('MEDIA_ROOT', value)}
          />
          <Path
            label="Music Root"
            value={envValue('MUSIC_ROOT')}
            onChange={(value) => updateEnv('MUSIC_ROOT', value)}
          />
          <Path
            label="Downloads Root"
            value={envValue('DOWNLOADS_ROOT')}
            onChange={(value) => updateEnv('DOWNLOADS_ROOT', value)}
          />
          <Path
            label="Backup Root"
            value={envValue('BACKUP_ROOT')}
            onChange={(value) => updateEnv('BACKUP_ROOT', value)}
          />
          <Text
            label="Backup Time"
            value={envValue('BACKUP_TIME') || '02:00'}
            onChange={(value) => updateEnv('BACKUP_TIME', value)}
          />
          <Select
            label="Backup Schedule"
            value={envValue('BACKUP_SCHEDULE') || 'weekly'}
            options={['daily', 'weekly']}
            onChange={(value) => updateEnv('BACKUP_SCHEDULE', value)}
          />
          <Select
            label="Backup Weekday"
            value={envValue('BACKUP_WEEKDAY') || 'Sun'}
            options={['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']}
            onChange={(value) => updateEnv('BACKUP_WEEKDAY', value)}
          />
          <NumberInput
            label="Backup Archives to Keep"
            value={envValue('BACKUP_RETENTION_COUNT') || '52'}
            onChange={(value) => {
              updateEnv('BACKUP_RETENTION_COUNT', value);
            }}
          />
          <Select
            label="Backup Encryption"
            value={envValue('BACKUP_ENCRYPTION') || 'keyfile'}
            options={['keyfile', 'none']}
            onChange={(value) => updateEnv('BACKUP_ENCRYPTION', value)}
          />
        </FormGrid>
      )}

      {section === 'profiles' && (
        <FormGrid>
          <Select
            label="Movie Preset"
            value={envValue('STACKARR_MOVIE_PROFILE_PRESET') || draftSettings.profiles.movieProfilePreset}
            options={mediaProfilePresetOptions}
            onChange={(value) =>
              updateProfilePreset(
                'movieProfilePreset',
                'STACKARR_MOVIE_PROFILE_PRESET',
                'movieDefault',
                'STACKARR_MOVIE_DEFAULT_PROFILE',
                value,
                mediaProfileName(value, 'hd')
              )
            }
          />
          <Text
            label="Movie Default"
            value={envValue('STACKARR_MOVIE_DEFAULT_PROFILE') || draftSettings.profiles.movieDefault}
            onChange={(value) => updateProfileName('movieDefault', 'STACKARR_MOVIE_DEFAULT_PROFILE', value)}
          />
          {separate4kEnabled && (
            <>
              <Select
                label="Movie 4K Preset"
                value={envValue('STACKARR_MOVIE_4K_PROFILE_PRESET') || draftSettings.profiles.movie4kProfilePreset}
                options={mediaProfilePresetOptions}
                onChange={(value) =>
                  updateProfilePreset(
                    'movie4kProfilePreset',
                    'STACKARR_MOVIE_4K_PROFILE_PRESET',
                    'movie4kDefault',
                    'STACKARR_MOVIE_4K_DEFAULT_PROFILE',
                    value,
                    mediaProfileName(value, '4k')
                  )
                }
              />
              <Text
                label="Movie 4K Default"
                value={envValue('STACKARR_MOVIE_4K_DEFAULT_PROFILE') || draftSettings.profiles.movie4kDefault}
                onChange={(value) => updateProfileName('movie4kDefault', 'STACKARR_MOVIE_4K_DEFAULT_PROFILE', value)}
              />
            </>
          )}
          <Select
            label="TV Preset"
            value={envValue('STACKARR_TV_PROFILE_PRESET') || draftSettings.profiles.tvProfilePreset}
            options={mediaProfilePresetOptions}
            onChange={(value) =>
              updateProfilePreset(
                'tvProfilePreset',
                'STACKARR_TV_PROFILE_PRESET',
                'tvDefault',
                'STACKARR_TV_DEFAULT_PROFILE',
                value,
                mediaProfileName(value, 'hd')
              )
            }
          />
          <Text
            label="TV Default"
            value={envValue('STACKARR_TV_DEFAULT_PROFILE') || draftSettings.profiles.tvDefault}
            onChange={(value) => updateProfileName('tvDefault', 'STACKARR_TV_DEFAULT_PROFILE', value)}
          />
          {separate4kEnabled && (
            <>
              <Select
                label="TV 4K Preset"
                value={envValue('STACKARR_TV_4K_PROFILE_PRESET') || draftSettings.profiles.tv4kProfilePreset}
                options={mediaProfilePresetOptions}
                onChange={(value) =>
                  updateProfilePreset(
                    'tv4kProfilePreset',
                    'STACKARR_TV_4K_PROFILE_PRESET',
                    'tv4kDefault',
                    'STACKARR_TV_4K_DEFAULT_PROFILE',
                    value,
                    mediaProfileName(value, '4k')
                  )
                }
              />
              <Text
                label="TV 4K Default"
                value={envValue('STACKARR_TV_4K_DEFAULT_PROFILE') || draftSettings.profiles.tv4kDefault}
                onChange={(value) => updateProfileName('tv4kDefault', 'STACKARR_TV_4K_DEFAULT_PROFILE', value)}
              />
            </>
          )}
          <Select
            label="Music Preset"
            value={envValue('STACKARR_MUSIC_PROFILE_PRESET') || draftSettings.profiles.musicProfilePreset}
            options={musicProfilePresetOptions}
            onChange={(value) =>
              updateProfilePreset(
                'musicProfilePreset',
                'STACKARR_MUSIC_PROFILE_PRESET',
                'musicDefault',
                'STACKARR_MUSIC_DEFAULT_PROFILE',
                value,
                musicProfileName(value)
              )
            }
          />
          <Text
            label="Music Default"
            value={envValue('STACKARR_MUSIC_DEFAULT_PROFILE') || draftSettings.profiles.musicDefault}
            onChange={(value) => updateProfileName('musicDefault', 'STACKARR_MUSIC_DEFAULT_PROFILE', value)}
          />
          <Check
            label="Separate HD/4K Instances"
            checked={separate4kEnabled}
            onChange={(value) => {
              updateEnvBool('ENABLE_4K_SERVARR', value);
              updateSettings('profiles', 'preferSeparateHd4kInstances', value);
              updateSettings('services', 'enable4kServarr', value);
            }}
          />
        </FormGrid>
      )}

      {section === 'services' && (
        <FormGrid>
          <Check
            label="Radarr/Sonarr 4K Instances"
            checked={envBool('ENABLE_4K_SERVARR', draftSettings.services.enable4kServarr)}
            onChange={(value) => {
              updateEnvBool('ENABLE_4K_SERVARR', value);
              updateSettings('services', 'enable4kServarr', value);
              updateSettings('profiles', 'preferSeparateHd4kInstances', value);
            }}
          />
          <Check
            label="Bazarr Subtitles"
            checked={envBool('ENABLE_BAZARR', draftSettings.services.enableBazarr)}
            onChange={(value) => {
              updateEnvBool('ENABLE_BAZARR', value);
              updateSettings('services', 'enableBazarr', value);
            }}
          />
          <Check
            label="Lidarr Music"
            checked={envBool('ENABLE_LIDARR', draftSettings.services.enableLidarr)}
            onChange={(value) => {
              updateEnvBool('ENABLE_LIDARR', value);
              updateSettings('services', 'enableLidarr', value);
            }}
          />
          <Check
            label="Immich Photos"
            checked={envBool('ENABLE_IMMICH', draftSettings.services.enableImmich)}
            onChange={(value) => {
              updateEnvBool('ENABLE_IMMICH', value);
              updateSettings('services', 'enableImmich', value);
            }}
          />
          <Check
            label="RomM Games"
            checked={envBool('ENABLE_ROMM', draftSettings.services.enableRomm)}
            onChange={(value) => {
              updateEnvBool('ENABLE_ROMM', value);
              updateSettings('services', 'enableRomm', value);
            }}
          />
          <Check
            label="Questarr Game Downloads"
            checked={envBool('ENABLE_QUESTARR', draftSettings.services.enableQuestarr)}
            onChange={(value) => {
              updateEnvBool('ENABLE_QUESTARR', value);
              updateSettings('services', 'enableQuestarr', value);
            }}
          />
          <Check
            label="TinyMediaManager Metadata"
            checked={envBool('ENABLE_TINYMEDIAMANAGER', draftSettings.services.enableTinyMediaManager)}
            onChange={(value) => {
              updateEnvBool('ENABLE_TINYMEDIAMANAGER', value);
              updateSettings('services', 'enableTinyMediaManager', value);
            }}
          />
          <Check
            label="Recyclarr Profile Sync"
            checked={envBool('ENABLE_RECYCLARR', draftSettings.services.enableRecyclarr)}
            onChange={(value) => {
              updateEnvBool('ENABLE_RECYCLARR', value);
              updateSettings('services', 'enableRecyclarr', value);
            }}
          />
          <Check
            label="FlareSolverr Indexer Helper"
            checked={envBool('ENABLE_FLARESOLVERR', draftSettings.services.enableFlaresolverr)}
            onChange={(value) => {
              updateEnvBool('ENABLE_FLARESOLVERR', value);
              updateSettings('services', 'enableFlaresolverr', value);
            }}
          />
          <Check
            label="Tidarr Tidal Helper"
            checked={envBool('ENABLE_TIDARR', draftSettings.services.enableTidarr)}
            onChange={(value) => {
              updateEnvBool('ENABLE_TIDARR', value);
              updateSettings('services', 'enableTidarr', value);
            }}
          />
          <Check
            label="Seerr Requests"
            checked={envBool('ENABLE_SEERR', draftSettings.services.enableSeerr)}
            onChange={(value) => {
              updateEnvBool('ENABLE_SEERR', value);
              updateSettings('services', 'enableSeerr', value);
            }}
          />
          <Check
            label="Pulsarr Watchlists"
            checked={envBool('ENABLE_PULSARR', draftSettings.services.enablePulsarr)}
            onChange={(value) => {
              updateEnvBool('ENABLE_PULSARR', value);
              updateSettings('services', 'enablePulsarr', value);
            }}
          />
          <Check
            label="Maintainerr Cleanup"
            checked={envBool('ENABLE_MAINTAINERR', draftSettings.services.enableMaintainerr)}
            onChange={(value) => {
              updateEnvBool('ENABLE_MAINTAINERR', value);
              updateSettings('services', 'enableMaintainerr', value);
            }}
          />
          <Check
            label="Cleanuparr Download Security"
            checked={envBool('ENABLE_CLEANUPARR', draftSettings.services.enableCleanuparr)}
            onChange={(value) => {
              updateEnvBool('ENABLE_CLEANUPARR', value);
              updateSettings('services', 'enableCleanuparr', value);
            }}
          />
          <Check
            label="Tracearr Monitoring"
            checked={envBool('ENABLE_TRACEARR', draftSettings.services.enableTracearr)}
            onChange={(value) => {
              updateEnvBool('ENABLE_TRACEARR', value);
              updateSettings('services', 'enableTracearr', value);
            }}
          />
          <Text
            label="Maintainerr Cleanup Presets"
            value={envValue('MAINTAINERR_CLEANUP_PRESETS')}
            onChange={(value) => updateEnv('MAINTAINERR_CLEANUP_PRESETS', value)}
          />
          <Text
            label="Maintainerr Plex URL"
            value={envValue('MAINTAINERR_PLEX_SERVER_URL')}
            onChange={(value) => updateEnv('MAINTAINERR_PLEX_SERVER_URL', value)}
          />
          <Text
            label="Maintainerr Jellyfin URL"
            value={envValue('MAINTAINERR_JELLYFIN_SERVER_URL')}
            onChange={(value) => updateEnv('MAINTAINERR_JELLYFIN_SERVER_URL', value)}
          />
          <Text
            label="Maintainerr qBittorrent URL"
            value={envValue('MAINTAINERR_QBITTORRENT_URL')}
            onChange={(value) => updateEnv('MAINTAINERR_QBITTORRENT_URL', value)}
          />
          <Text
            label="Immich URL"
            value={envValue('IMMICH_URL')}
            onChange={(value) => updateEnv('IMMICH_URL', value)}
          />
          <Text
            label="Immich Bind IP"
            value={envValue('IMMICH_BIND_IP')}
            onChange={(value) => updateEnv('IMMICH_BIND_IP', value)}
          />
          <Text
            label="Immich Port"
            value={envValue('IMMICH_WEB_PORT')}
            onChange={(value) => updateEnv('IMMICH_WEB_PORT', value)}
          />
          <Text
            label="Immich Upload Location"
            value={envValue('IMMICH_UPLOAD_LOCATION')}
            onChange={(value) => updateEnv('IMMICH_UPLOAD_LOCATION', value)}
          />
          <Text label="RomM URL" value={envValue('ROMM_URL')} onChange={(value) => updateEnv('ROMM_URL', value)} />
          <Text
            label="RomM Bind IP"
            value={envValue('ROMM_BIND_IP')}
            onChange={(value) => updateEnv('ROMM_BIND_IP', value)}
          />
          <Text
            label="RomM Port"
            value={envValue('ROMM_WEB_PORT')}
            onChange={(value) => updateEnv('ROMM_WEB_PORT', value)}
          />
          <Text
            label="RomM Library Root"
            value={envValue('ROMM_LIBRARY_ROOT') || envValue('GAMES_ROOT')}
            onChange={(value) => {
              updateEnv('ROMM_LIBRARY_ROOT', value);
              updateEnv('GAMES_ROOT', value);
            }}
          />
          <Text
            label="Tracearr URL"
            value={envValue('TRACEARR_URL')}
            onChange={(value) => updateEnv('TRACEARR_URL', value)}
          />
          <Text
            label="Tracearr Bind IP"
            value={envValue('TRACEARR_BIND_IP')}
            onChange={(value) => updateEnv('TRACEARR_BIND_IP', value)}
          />
          <Text
            label="Tracearr Port"
            value={envValue('TRACEARR_PORT')}
            onChange={(value) => updateEnv('TRACEARR_PORT', value)}
          />
          <Check
            label="Tracearr Auto-configure"
            checked={envBool('TRACEARR_AUTO_CONFIGURE', true)}
            onChange={(value) => updateEnvBool('TRACEARR_AUTO_CONFIGURE', value)}
          />
          <Text
            label="Tracearr Owner Username"
            value={envValue('TRACEARR_ADMIN_USERNAME')}
            onChange={(value) => updateEnv('TRACEARR_ADMIN_USERNAME', value)}
          />
          <Text
            label="Tracearr Owner Email"
            value={envValue('TRACEARR_ADMIN_EMAIL')}
            onChange={(value) => updateEnv('TRACEARR_ADMIN_EMAIL', value)}
          />
          <Password
            label="Tracearr Owner Password"
            value={envValue('TRACEARR_ADMIN_PASSWORD')}
            onChange={(value) => updateEnv('TRACEARR_ADMIN_PASSWORD', value)}
          />
          <Password
            label="Tracearr Claim Code"
            value={envValue('TRACEARR_CLAIM_CODE')}
            onChange={(value) => updateEnv('TRACEARR_CLAIM_CODE', value)}
          />
          <Text
            label="Tracearr Plex URL"
            value={envValue('TRACEARR_PLEX_SERVER_URL')}
            onChange={(value) => updateEnv('TRACEARR_PLEX_SERVER_URL', value)}
          />
          <Text
            label="Tracearr Jellyfin URL"
            value={envValue('TRACEARR_JELLYFIN_SERVER_URL')}
            onChange={(value) => updateEnv('TRACEARR_JELLYFIN_SERVER_URL', value)}
          />
          <Text
            label="Tracearr Emby URL"
            value={envValue('TRACEARR_EMBY_SERVER_URL')}
            onChange={(value) => updateEnv('TRACEARR_EMBY_SERVER_URL', value)}
          />
        </FormGrid>
      )}

      {section === 'downloadclients' && (
        <FormGrid>
          <Select
            label="Preferred Torrent Client"
            value={envValue('PREFERRED_TORRENT_CLIENT') || 'transmission'}
            options={['transmission', 'qbittorrent']}
            onChange={(value) => updateEnv('PREFERRED_TORRENT_CLIENT', value)}
          />
          <Text
            label="Transmission Bind IP"
            value={envValue('TRANSMISSION_BIND_IP')}
            onChange={(value) => updateEnv('TRANSMISSION_BIND_IP', value)}
          />
          <Text
            label="qBittorrent Bind IP"
            value={envValue('QBITTORRENT_BIND_IP')}
            onChange={(value) => updateEnv('QBITTORRENT_BIND_IP', value)}
          />
          <Text
            label="qBittorrent Web UI Port"
            value={envValue('QBITTORRENT_WEBUI_PORT')}
            onChange={(value) => updateEnv('QBITTORRENT_WEBUI_PORT', value)}
          />
        </FormGrid>
      )}

      {section === 'indexers' && (
        <div className={styles.note}>
          Prowlarr owns indexer configuration. Stackarr manages app sync defaults and exposes status/actions from System
          without duplicating Prowlarr's indexer database.
        </div>
      )}

      {section === 'connect' && (
        <FormGrid>
          <div className={styles.note}>
            Use a Cloudflare account API token with Tunnel Edit, Access Policies Edit, Zero Trust Edit, Zone Read, and
            DNS Edit. Stackarr creates the tunnel, connector credential, DNS records, and Access apps automatically.
          </div>
          <Password
            label="Cloudflare API Token"
            value={envValue('CLOUDFLARE_API_TOKEN')}
            onChange={(value) => updateEnv('CLOUDFLARE_API_TOKEN', value)}
          />
          <Text
            label="Cloudflare Account ID"
            value={envValue('CLOUDFLARE_ACCOUNT_ID')}
            onChange={(value) => updateEnv('CLOUDFLARE_ACCOUNT_ID', value)}
          />
          <Text
            label="Cloudflare Zone ID"
            value={envValue('CLOUDFLARE_ZONE_ID')}
            onChange={(value) => updateEnv('CLOUDFLARE_ZONE_ID', value)}
          />
          <Text
            label="Cloudflare Tunnel Name"
            value={envValue('CLOUDFLARED_TUNNEL_NAME')}
            onChange={(value) => updateEnv('CLOUDFLARED_TUNNEL_NAME', value)}
          />
          <Text
            label="Cloudflare Tunnel ID"
            value={envValue('CLOUDFLARED_TUNNEL_ID')}
            onChange={(value) => updateEnv('CLOUDFLARED_TUNNEL_ID', value)}
          />
          <Check
            label="Protect Routes with Access"
            checked={envBool('CLOUDFLARE_ACCESS_ENABLED', false)}
            onChange={(value) => updateEnvBool('CLOUDFLARE_ACCESS_ENABLED', value)}
          />
          <Text
            label="Access Allowed Emails"
            value={envValue('CLOUDFLARE_ACCESS_ALLOWED_EMAILS')}
            onChange={(value) => updateEnv('CLOUDFLARE_ACCESS_ALLOWED_EMAILS', value)}
          />
          <Text
            label="Access Session Duration"
            value={envValue('CLOUDFLARE_ACCESS_SESSION_DURATION') || '720h'}
            onChange={(value) => updateEnv('CLOUDFLARE_ACCESS_SESSION_DURATION', value)}
          />
          <div className={styles.routeEditor}>
            <div className={styles.routeHeader}>
              <span>Cloudflare Routes</span>
              <button onClick={addCloudflareRoute} type="button">
                Add route
              </button>
            </div>
            {cloudflareRoutes.length === 0 && <p>No public routes configured.</p>}
            {cloudflareRoutes.map((route, index) => (
              <div className={styles.routeRow} key={`cloudflare-route-${index}`}>
                <input
                  aria-label="Public hostname"
                  placeholder="books.example.com"
                  value={route.hostname}
                  onChange={(event) => updateCloudflareRoute(index, { hostname: event.target.value })}
                />
                <select
                  aria-label="Stackarr service"
                  value={route.service}
                  onChange={(event) =>
                    updateCloudflareRoute(index, {
                      service: event.target.value,
                      access: defaultCloudflareRouteAccess(event.target.value)
                    })
                  }
                >
                  {cloudflareServiceOptions.map((service) => (
                    <option key={service} value={service}>
                      {service}
                    </option>
                  ))}
                </select>
                <Switch
                  aria-label={`Protect ${route.hostname || route.service || 'route'} with Access`}
                  className={styles.routeAccess}
                  isSelected={route.access ?? defaultCloudflareRouteAccess(route.service)}
                  onChange={(access) => updateCloudflareRoute(index, { access })}
                >
                  <Switch.Content>
                    <Label>Access</Label>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                  </Switch.Content>
                </Switch>
                <button onClick={() => removeCloudflareRoute(index)} type="button">
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className={styles.actionRow}>
            <span>Cloudflare Tunnel</span>
            <span className={styles.inlineActions}>
              <button onClick={applyCloudflareRoutes} type="button">
                {cloudflareApplyState === 'saving'
                  ? 'Saving...'
                  : cloudflareApplyState === 'queued'
                    ? 'Queued'
                    : cloudflareApplyState === 'error'
                      ? 'Failed'
                      : 'Apply routes'}
              </button>
              <button onClick={rotateTunnelToken} type="button">
                {rotateState === 'saving'
                  ? 'Saving...'
                  : rotateState === 'queued'
                    ? 'Queued'
                    : rotateState === 'error'
                      ? 'Failed'
                      : 'Rotate connector'}
              </button>
            </span>
          </div>
          <Check
            label="Expose Listed Routes Only"
            checked={draftSettings.connect.exposeSeerrOnly}
            onChange={(value) => updateSettings('connect', 'exposeSeerrOnly', value)}
          />
          <Check
            label="Warn Before Public Exposure"
            checked={draftSettings.connect.warnBeforePublicExposure}
            onChange={(value) => updateSettings('connect', 'warnBeforePublicExposure', value)}
          />
        </FormGrid>
      )}

      {section === 'metadata' && (
        <FormGrid>
          <Check
            label="TinyMediaManager Enabled"
            checked={draftSettings.metadata.tinyMediaManagerEnabled}
            onChange={(value) => updateSettings('metadata', 'tinyMediaManagerEnabled', value)}
          />
          <Check
            label="Plex Metadata Monitoring"
            checked={draftSettings.metadata.plexMetadataMonitoring}
            onChange={(value) => updateSettings('metadata', 'plexMetadataMonitoring', value)}
          />
          <Check
            label="Jellyfin Metadata Monitoring"
            checked={draftSettings.metadata.jellyfinMetadataMonitoring}
            onChange={(value) => updateSettings('metadata', 'jellyfinMetadataMonitoring', value)}
          />
        </FormGrid>
      )}

      {section === 'account' && (
        <div className={styles.securityLayout}>
          <section className={styles.securitySection}>
            <div className={styles.securityHeading}>
              <span className={styles.securityIcon}>
                <LockIcon size={16} />
              </span>
              <div>
                <h3>Stackarr Account</h3>
                <p>Change the dashboard sign-in and the global identity used by managed service setup.</p>
              </div>
            </div>
            <FormGrid>
              <Text
                label="Username"
                value={envValue('USERNAME')}
                error={usernameValidationMessage}
                maxLength={accountUsernameMaximumLength}
                onChange={(value) => updateEnv('USERNAME', value)}
              />
              <Text label="Email" value={envValue('USER_EMAIL')} onChange={(value) => updateEnv('USER_EMAIL', value)} />
              <Select
                label="Access protection"
                value={draftSettings.host.authenticationMethod}
                options={[
                  { value: 'forms', label: 'Dashboard sign-in + API key' },
                  { value: 'none', label: 'No authentication (unsafe)' }
                ]}
                onChange={(value) =>
                  updateSettings(
                    'host',
                    'authenticationMethod',
                    value as StackarrSettings['host']['authenticationMethod']
                  )
                }
              />
              <Password
                label="API Key"
                value={envValue('STACKARR_API_KEY')}
                onChange={(value) => updateEnv('STACKARR_API_KEY', value)}
              />
              <Password
                label="Current Admin Password"
                value={accountCurrentPassword}
                autoComplete="current-password"
                error={currentAdminPasswordError(
                  accountCurrentPassword,
                  envValue('USERNAME') !== (env.USERNAME ?? '') ||
                    envValue('USER_EMAIL') !== (env.USER_EMAIL ?? '') ||
                    envValue('STACKARR_API_KEY') !== (env.STACKARR_API_KEY ?? '') ||
                    Boolean(accountPassword || accountPasswordConfirm)
                )}
                onChange={setAccountCurrentPassword}
              />
              <Password
                label="New Account Password"
                value={accountPassword}
                autoComplete="new-password"
                error={passwordConfirmationError('Account password', accountPassword, accountPasswordConfirm)}
                onChange={setAccountPassword}
              />
              <Password
                label="Confirm Account Password"
                value={accountPasswordConfirm}
                autoComplete="new-password"
                onChange={setAccountPasswordConfirm}
              />
              <div className={styles.actionRow}>
                <span>Apply Account Change</span>
                <Button isDisabled={accountState === 'saving'} onPress={applyAccountSettings}>
                  <KeyIcon size={15} />
                  {accountState === 'saving' ? 'Saving...' : accountState === 'queued' ? 'Queued' : 'Save account'}
                </Button>
              </div>
            </FormGrid>
          </section>

          <div className={styles.securityNote}>
            Dashboard sign-in protects people with a username, password, and private browser session. The API key stays
            active at the same time for agents and integrations. Username and email changes keep this browser signed in;
            password changes renew this browser and revoke older sessions. Managed app sign-ins follow the account
            password, while Postgres passwords stay under Security.
          </div>
        </div>
      )}

      {section === 'security' && (
        <div className={styles.securityLayout}>
          <section className={styles.securitySection}>
            <div className={styles.securityHeading}>
              <span className={styles.securityIcon}>
                <LockIcon size={16} />
              </span>
              <div>
                <h3>Service Credentials</h3>
                <p>Change an individual service login or a managed Postgres role password.</p>
              </div>
            </div>
            <FormGrid>
              <Select
                label="Service"
                value={securityServiceId}
                options={[
                  { value: '', label: 'Choose service...' },
                  ...securityServices.map((service) => ({ value: service.id, label: service.label }))
                ]}
                onChange={updateSecurityService}
              />
              {selectedSecurityService && (
                <>
                  <Select
                    label="Credential"
                    value={securityCredentialType}
                    options={selectedSecurityCredentialOptions}
                    onChange={(value) => setSecurityCredentialType(value as SecurityCredentialType)}
                  />
                  <div className={styles.securitySummary}>
                    <strong>{selectedSecurityService.label}</strong>
                    <span>{selectedSecurityService.description}</span>
                  </div>
                  <Password
                    label="Current Admin Password"
                    value={serviceCurrentPassword}
                    autoComplete="current-password"
                    error={currentAdminPasswordError(serviceCurrentPassword)}
                    onChange={setServiceCurrentPassword}
                  />
                  <Password
                    label="New Service Password"
                    value={servicePassword}
                    autoComplete="new-password"
                    error={passwordConfirmationError(
                      `${selectedSecurityService.label} password`,
                      servicePassword,
                      servicePasswordConfirm
                    )}
                    onChange={setServicePassword}
                  />
                  <Password
                    label="Confirm Service Password"
                    value={servicePasswordConfirm}
                    autoComplete="new-password"
                    onChange={setServicePasswordConfirm}
                  />
                  <div className={styles.actionRow}>
                    <span>Apply Service Change</span>
                    <Button isDisabled={securityState === 'saving'} onPress={applyServicePassword}>
                      <KeyIcon size={15} />
                      {securityState === 'saving'
                        ? 'Saving...'
                        : securityState === 'queued'
                          ? 'Queued'
                          : 'Update selected service'}
                    </Button>
                  </div>
                </>
              )}
            </FormGrid>
          </section>

          <div className={styles.securityNote}>
            Runtime secrets are still stored in Stackarr's local config database today. The Settings API redacts them
            before returning config to the browser; at-rest encryption is a separate migration because shell automation
            also reads these values.
          </div>
        </div>
      )}

      {section === 'general' && (
        <FormGrid>
          <Text label="Timezone" value={envValue('TIMEZONE')} onChange={(value) => updateEnv('TIMEZONE', value)} />
          <Text
            label="Bind Address"
            value={draftSettings.host.bindAddress}
            onChange={(value) => {
              updateSettings('host', 'bindAddress', value);
              updateEnv('STACKARR_BIND_IP', value);
            }}
          />
          <Text
            label="Port"
            value={String(draftSettings.host.port)}
            onChange={(value) => {
              updateSettings('host', 'port', Number(value) || 7777);
              updateEnv('STACKARR_WEB_PORT', value);
            }}
          />
          <Text
            label="URL Base"
            value={draftSettings.host.urlBase}
            onChange={(value) => updateSettings('host', 'urlBase', value)}
          />
          <Check
            label="Enable SSL"
            checked={draftSettings.host.enableSsl}
            onChange={(value) => updateSettings('host', 'enableSsl', value)}
          />
          {telemetryFeatureEnabled && (
            <div className={styles.telemetryControl}>
              <Check
                label="Send Anonymous Usage Data"
                description="Opt in to one first-party heartbeat per day. It includes the Stackarr version, platform, enabled-app categories, backup shape, and anonymous issue codes—never paths, hostnames, account data, media activity, logs, or credentials. Takes effect immediately."
                checked={draftSettings.telemetry.enabled}
                onChange={updateTelemetryEnabled}
              />
              <button className={styles.previewButton} onClick={previewTelemetry} type="button">
                {telemetryPreview ? 'Refresh exact payload' : 'Preview exact payload'}
              </button>
              {telemetryPreview && (
                <pre className={styles.telemetryPreview}>{JSON.stringify(telemetryPreview, null, 2)}</pre>
              )}
            </div>
          )}
        </FormGrid>
      )}

      {section === 'general' && draftSettings.ui.showAdvanced && (
        <FormGrid>
          {protectedEnvPasswordChanged && (
            <Password
              label="Current Admin Password"
              value={generalCurrentPassword}
              autoComplete="current-password"
              error={currentAdminPasswordError(generalCurrentPassword)}
              onChange={setGeneralCurrentPassword}
            />
          )}
          {advancedEnvKeys.map((key) => {
            const Field = isSecretEnvKey(key) ? Password : Text;
            const error = isPortablePasswordEnvKey(key)
              ? validatePortablePasswordValue(key, envValue(key), env[key] ?? '')
              : '';
            return (
              <Field
                key={key}
                label={key}
                value={envValue(key)}
                error={error}
                onChange={(value) => updateEnv(key, value)}
              />
            );
          })}
        </FormGrid>
      )}

      {section === 'ui' && (
        <FormGrid>
          <Select
            label="Theme"
            value={draftSettings.ui.theme}
            options={themeOptions}
            onChange={(value) => updateSettings('ui', 'theme', value as StackarrSettings['ui']['theme'])}
          />
          <Text
            label="Refresh Interval Seconds"
            value={String(draftSettings.ui.refreshIntervalSeconds)}
            onChange={(value) => updateSettings('ui', 'refreshIntervalSeconds', Number(value) || 30)}
          />
          <Select
            label="Service Link Mode"
            value={draftSettings.ui.serviceUrlMode}
            options={['localhost', 'portless', 'loopback']}
            onChange={(value) =>
              updateSettings('ui', 'serviceUrlMode', value as StackarrSettings['ui']['serviceUrlMode'])
            }
          />
          <Select
            label="Portless Scheme"
            value={draftSettings.ui.serviceUrlScheme}
            options={['https', 'http']}
            onChange={(value) =>
              updateSettings('ui', 'serviceUrlScheme', value as StackarrSettings['ui']['serviceUrlScheme'])
            }
          />
          <Text
            label="Portless Host Suffix"
            value={draftSettings.ui.serviceUrlHostSuffix}
            onChange={(value) => updateSettings('ui', 'serviceUrlHostSuffix', value)}
          />
          <Check
            label="Show Advanced Settings"
            checked={draftSettings.ui.showAdvanced}
            onChange={(value) => updateSettings('ui', 'showAdvanced', value)}
          />
        </FormGrid>
      )}

      {section !== 'security' && section !== 'account' && (
        <div className={styles.footer}>
          <button onClick={save} type="button">
            {state === 'saving' ? 'Saving...' : 'Save'}
          </button>
          {state === 'saved' && <span>{message || 'Saved'}</span>}
          {state === 'error' && <span className={styles.error}>{message || 'Save failed'}</span>}
        </div>
      )}
      {section === 'account' && accountState !== 'idle' && (
        <div className={styles.footer}>
          {accountState === 'queued' && <span>{message || 'Account settings saved.'}</span>}
          {accountState === 'error' && <span className={styles.error}>{message || 'Account update failed'}</span>}
        </div>
      )}
      {section === 'security' && securityState !== 'idle' && (
        <div className={styles.footer}>
          {securityState === 'queued' && <span>{message || 'Security apply queued.'}</span>}
          {securityState === 'error' && <span className={styles.error}>{message || 'Security update failed'}</span>}
        </div>
      )}
    </div>
  );
}

function portlessHostActionMessage(action: unknown) {
  if (!action || typeof action !== 'object') {
    return '';
  }

  const { command, status } = action as { command?: unknown; status?: unknown };

  if (status === 'host-required' && typeof command === 'string') {
    return ` Open Terminal and run: ${command}.`;
  }

  return '';
}

function cloudflareExposureWarning(routes: CloudflareRoute[], accessEnabled: boolean) {
  const services = new Set(routes.map((route) => route.service));
  const hasDownloader = services.has('transmission') || services.has('qbittorrent');
  const publicRoutes = routes.filter((route) => !(route.access ?? defaultCloudflareRouteAccess(route.service)));
  const routeList = routes
    .map((route) => {
      const protection = (route.access ?? defaultCloudflareRouteAccess(route.service)) ? 'Access' : 'public/mobile';
      return `${route.hostname} -> ${route.service} (${protection})`;
    })
    .join('\n');

  return [
    `Apply ${routes.length} public Cloudflare route${routes.length === 1 ? '' : 's'}?`,
    accessEnabled ? '' : 'Cloudflare Access protection is off; public routes will rely only on each app login.',
    publicRoutes.length ? 'Routes marked public/mobile will not get a Cloudflare Access app.' : '',
    hasDownloader ? 'Downloader web UIs should be protected with Cloudflare Access and strong app credentials.' : '',
    routeList
  ]
    .filter(Boolean)
    .join('\n\n');
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return <div className={styles.formGrid}>{children}</div>;
}

function Text({
  label,
  value,
  error,
  maxLength,
  onChange
}: {
  label: string;
  value: string;
  error?: string;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        aria-invalid={Boolean(error)}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <small className={styles.error}>{error}</small>}
    </label>
  );
}

function Path({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <PathInput value={value} onChange={onChange} />
    </label>
  );
}

function Password({
  label,
  value,
  autoComplete = 'off',
  error,
  onChange
}: {
  label: string;
  value: string;
  autoComplete?: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const savedPreview = isMiddleTruncatedSecret(value) ? value : '';

  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.passwordControl}>
        <input
          id={id}
          aria-invalid={Boolean(error)}
          autoComplete={autoComplete}
          maxLength={isPortablePasswordEnvKey(label) ? portablePasswordMaximumLength : undefined}
          spellCheck={false}
          title={
            isPortablePasswordEnvKey(label)
              ? `Use ${portablePasswordMinimumLength}–${portablePasswordMaximumLength} characters. Spaces, punctuation, and Unicode are supported.`
              : undefined
          }
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <span className={styles.passwordToggleWrap} title={`${visible ? 'Hide' : 'Show'} ${label}`}>
          <Button
            aria-label={`${visible ? 'Hide' : 'Show'} ${label}`}
            className={styles.passwordToggle}
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => setVisible((current) => !current)}
          >
            <EyeIcon size={14} />
          </Button>
        </span>
      </div>
      {error && <small>{error}</small>}
      {!error && savedPreview && (
        <small className={styles.secretPreview}>
          Saved as <code>{savedPreview}</code>
        </small>
      )}
    </div>
  );
}

function isMiddleTruncatedSecret(value: string) {
  return value.includes('...') && value !== '...' && !/^\*+$/.test(value);
}

function NumberInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input min="1" step="1" type="number" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function Select({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={selectOptionValue(option)} value={selectOptionValue(option)}>
            {selectOptionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Check({
  label,
  description,
  checked,
  onChange
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Switch className={styles.check} isSelected={checked} onChange={onChange}>
      <Switch.Content>
        <span className={styles.checkCopy}>
          <Label>{label}</Label>
          {description && <small>{description}</small>}
        </span>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}

function selectOptionValue(option: SelectOption) {
  return typeof option === 'string' ? option : option.value;
}

function selectOptionLabel(option: SelectOption) {
  return typeof option === 'string' ? option : option.label;
}

function securityCredentialOptions(service: SecurityServiceTarget): SelectOption[] {
  const options: SelectOption[] = [];

  if (service.accessKeys?.length) {
    options.push({ value: 'access', label: 'Frontend/admin access' });
  }

  if (service.databaseKeys?.length) {
    options.push({ value: 'database', label: 'Postgres role' });
  }

  return options;
}

function applyPasswordPatch(env: StackarrEnv, keys: string[], password: string): StackarrEnv {
  const next = { ...env };

  for (const key of keys) {
    next[key] = password;
  }

  return next;
}

function applyAccountIdentityPatch(env: StackarrEnv, currentEnv: StackarrEnv): StackarrEnv {
  const next: StackarrEnv = {
    ...env,
    USERNAME: String(env.USERNAME ?? '').trim(),
    USER_EMAIL: String(env.USER_EMAIL ?? '').trim()
  };
  const oldUsername = String(currentEnv.USERNAME ?? '').trim();
  const oldEmail = String(currentEnv.USER_EMAIL ?? '').trim();

  if (identityFieldFollowsGlobal(currentEnv.TRACEARR_ADMIN_USERNAME, oldUsername, '')) {
    next.TRACEARR_ADMIN_USERNAME = next.USERNAME || 'stackarr';
  }

  if (identityFieldFollowsGlobal(currentEnv.TRACEARR_ADMIN_EMAIL, oldEmail, '')) {
    next.TRACEARR_ADMIN_EMAIL = next.USER_EMAIL;
  }

  next.CLOUDFLARE_ACCESS_ALLOWED_EMAILS = syncAccountEmailList(
    next.CLOUDFLARE_ACCESS_ALLOWED_EMAILS,
    oldEmail,
    next.USER_EMAIL,
    next.CLOUDFLARE_ACCESS_ENABLED
  );

  return next;
}

function identityFieldFollowsGlobal(value: string | undefined, oldGlobalValue: string, emptyValue: string) {
  const normalized = String(value ?? '').trim();
  return normalized === emptyValue || (!!oldGlobalValue && normalized === oldGlobalValue);
}

function syncAccountEmailList(
  value: string | undefined,
  oldEmail: string,
  newEmail: string,
  accessEnabled: string | undefined
) {
  const emails = String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const normalizedOldEmail = oldEmail.toLowerCase();
  let changed = false;

  const nextEmails = emails.flatMap((email) => {
    if (normalizedOldEmail && email.toLowerCase() === normalizedOldEmail) {
      changed = true;
      return newEmail ? [newEmail] : [];
    }

    return [email];
  });

  if (
    !changed &&
    newEmail &&
    nextEmails.length === 0 &&
    ['1', 'true', 'yes', 'on'].includes(String(accessEnabled ?? '').toLowerCase())
  ) {
    nextEmails.push(newEmail);
    changed = true;
  }

  if (!changed) {
    return value ?? '';
  }

  return Array.from(new Map(nextEmails.map((email) => [email.toLowerCase(), email])).values()).join(',');
}

function currentAdminPasswordError(password: string, required = false) {
  if (!password && required) {
    return 'Current admin password is required.';
  }

  return '';
}

function passwordConfirmationError(label: string, password: string, confirmation: string) {
  if (!password && !confirmation) {
    return '';
  }

  if (!password) {
    return `${label} is required.`;
  }

  const validation = portablePasswordValueError(label, password, '');
  if (validation) {
    return validation;
  }

  if (password !== confirmation) {
    return `${label} confirmation does not match.`;
  }

  return '';
}

function isSecretEnvKey(key: string) {
  const normalized = key.toUpperCase();
  return (
    ['PASSWORD', 'TOKEN', 'API_KEY', 'SECRET', 'KEY', 'CLAIM_CODE'].some((fragment) => normalized.includes(fragment)) ||
    normalized === 'DATABASE_URL' ||
    normalized.endsWith('_DATABASE_URL') ||
    normalized.endsWith('_DB_URL')
  );
}

function protectedEnvChangeRequiresCurrentPassword(draftEnv: StackarrEnv, currentEnv: StackarrEnv) {
  for (const [key, value] of Object.entries(draftEnv)) {
    if (!isCurrentPasswordProtectedEnvKey(key)) {
      continue;
    }

    if (String(value ?? '') !== String(currentEnv[key] ?? '')) {
      return true;
    }
  }

  return false;
}

function isCurrentPasswordProtectedEnvKey(key: string) {
  const normalized = key.toUpperCase();

  return normalized === 'USERNAME' || normalized === 'USER_EMAIL' || isSecretEnvKey(normalized);
}

function isPortablePasswordEnvKey(key: string) {
  return key === 'PASSWORD' || key.endsWith('_PASSWORD');
}

function firstPortablePasswordValidationError(draftEnv: StackarrEnv, currentEnv: StackarrEnv) {
  for (const [key, value] of Object.entries(draftEnv)) {
    if (!isPortablePasswordEnvKey(key)) {
      continue;
    }

    const error = validatePortablePasswordValue(key, value, currentEnv[key] ?? '');
    if (error) {
      return error;
    }
  }

  return '';
}

function validatePortablePasswordValue(key: string, value: string, currentValue: string) {
  return portablePasswordValueError(humanizePasswordKey(key), value, currentValue);
}

function portablePasswordValueError(label: string, value: string, currentValue: string) {
  if (!value || value === currentValue) {
    return '';
  }

  return portablePasswordValidationError(value, label) ?? '';
}

function humanizePasswordKey(key: string) {
  if (key === 'PASSWORD') {
    return 'Global password';
  }

  return key
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseCloudflareRoutes(value: string): CloudflareRoute[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => ({
        hostname: normalizeHostname(String(item?.hostname ?? '')),
        service: String(item?.service ?? 'pulsarr').toLowerCase(),
        access: parseCloudflareRouteAccess(item?.access, String(item?.service ?? 'pulsarr'))
      }))
      .filter((route) => route.hostname || route.service);
  } catch {
    return [];
  }
}

function normalizeHostname(value: string) {
  return value
    .replace(/^https?:\/\//, '')
    .split('/')[0]
    .trim()
    .toLowerCase();
}

function defaultCloudflareRouteAccess(service: string) {
  return !['immich', 'photos', 'pics'].includes(service.trim().toLowerCase());
}

function parseCloudflareRouteAccess(value: unknown, service: string) {
  if (typeof value === 'boolean') {
    return value;
  }

  const token = String(value ?? '')
    .trim()
    .toLowerCase();

  if (['1', 'true', 'yes', 'on', 'access', 'protected'].includes(token)) {
    return true;
  }

  if (['0', 'false', 'no', 'off', 'public', 'mobile', 'none'].includes(token)) {
    return false;
  }

  return defaultCloudflareRouteAccess(service);
}

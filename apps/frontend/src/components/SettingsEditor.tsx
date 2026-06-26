'use client';

import type { StackarrEnv, StackarrSettings } from '@stackarr/core';
import { applyStackarrDocumentTheme } from '@stackarr/ui/theme-provider';
import { toast } from '@stackarr/ui/toast';
import type React from 'react';
import { useState } from 'react';
import { stackarrFetch } from './clientApi';
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
};

const storageEnvKeys = ['MEDIA_ROOT', 'MUSIC_ROOT', 'DOWNLOADS_ROOT', 'BACKUP_ROOT'] as const;
const mediaProfilePresetOptions = ['lite', 'balanced'];
const musicProfilePresetOptions = ['lossless', 'lossy'];
const themeOptions: Array<StackarrSettings['ui']['theme']> = ['light', 'dark', 'system'];
const cloudflareServiceOptions = [
  'pulsarr',
  'bookorbit',
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
const portablePasswordPattern = /^[A-Za-z0-9._-]+$/;
const portablePasswordDescription = 'letters, numbers, dot, underscore, and hyphen';
const portablePasswordMinimumLength = 8;

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
  const [rotateState, setRotateState] = useState<'idle' | 'saving' | 'queued' | 'error'>('idle');
  const [cloudflareApplyState, setCloudflareApplyState] = useState<'idle' | 'saving' | 'queued' | 'error'>('idle');
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
  const telemetryFeatureEnabled = envBool('STACKARR_TELEMETRY_FEATURE_ENABLED', false);
  const advancedEnvKeys = Object.keys(draftEnv)
    .filter((key) => /^[A-Z][A-Z0-9_]*$/.test(key))
    .filter((key) => telemetryFeatureEnabled || !key.startsWith('STACKARR_TELEMETRY_'))
    .sort();
  const passwordValidationMessage = firstPortablePasswordValidationError(draftEnv, env);
  const cloudflareRoutes = parseCloudflareRoutes(envValue('CLOUDFLARE_TUNNEL_ROUTES'));

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

  async function saveConfig() {
    const response = await stackarrFetch('/api/v1/config/stackarr', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ config: draftEnv, settings: draftSettings })
    });
    const body = await response.json().catch(() => ({}));

    return { response, body };
  }

  async function save() {
    if (passwordValidationMessage) {
      setState('error');
      setMessage(passwordValidationMessage);
      toast.error(passwordValidationMessage);
      return;
    }

    setState('saving');
    setMessage('');
    const toastId = toast.loading('Saving settings...');
    const storageChanged = storageEnvKeys.some((key) => envValue(key) !== (env[key] ?? ''));
    const { response, body } = await saveConfig();

    setState(response.ok ? 'saved' : 'error');
    if (response.ok) {
      if (storageChanged) {
        const applyResponse = await stackarrFetch('/api/v1/command', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'StackStart' })
        });
        const nextMessage = applyResponse.ok
          ? 'Saved. Storage mounts apply queued.'
          : 'Saved. Storage mounts need apply from System.';

        setMessage(nextMessage);
        toast[applyResponse.ok ? 'success' : 'error'](nextMessage, { id: toastId });
        return;
      }

      const nextMessage = portlessSaveMessage(body.portlessTask);
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
      'Rotate the Cloudflare tunnel token by recreating the Cloudflare tunnel and saving the new runtime credential?'
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
        typeof body.error === 'string' ? body.error : 'Save failed. The tunnel token was not rotated.';
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
      ? 'Saved. Cloudflare tunnel token rotation queued.'
      : 'Saved, but tunnel token rotation failed to queue.';
    setMessage(nextMessage);
    toast[rotateResponse.ok ? 'success' : 'error'](nextMessage, { id: toastId });
  }

  async function applyCloudflareRoutes() {
    const publicRoutes = cloudflareRoutes.filter((route) => route.hostname);
    if (draftSettings.connect.warnBeforePublicExposure && publicRoutes.length > 0) {
      const confirmed = window.confirm(cloudflareExposureWarning(publicRoutes));

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
      body: JSON.stringify({ name: 'CloudflareInstall' })
    });

    setCloudflareApplyState(applyResponse.ok ? 'queued' : 'error');
    const nextMessage = applyResponse.ok
      ? 'Saved. Cloudflare route apply queued.'
      : 'Saved, but Cloudflare route apply failed to queue.';
    setMessage(nextMessage);
    toast[applyResponse.ok ? 'success' : 'error'](nextMessage, { id: toastId });
  }

  function updateCloudflareRoutes(routes: CloudflareRoute[]) {
    const normalized = routes
      .map((route) => ({ hostname: normalizeHostname(route.hostname), service: route.service || 'pulsarr' }))
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
    updateCloudflareRoutes([...cloudflareRoutes, { hostname: '', service: 'pulsarr' }]);
  }

  function removeCloudflareRoute(index: number) {
    updateCloudflareRoutes(cloudflareRoutes.filter((_, routeIndex) => routeIndex !== index));
  }

  function updateTelemetryEnabled(value: boolean) {
    if (value && !draftSettings.telemetry.enabled) {
      const confirmed = window.confirm(
        'Share anonymous Stackarr heartbeat metrics for product decisions? No paths, hostnames, titles, usernames, or secrets are sent.'
      );

      if (!confirmed) {
        return;
      }
    }

    updateSettings('telemetry', 'enabled', value);
    updateEnvBool('STACKARR_TELEMETRY_ENABLED', value);
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
            label="Backup Mode"
            value={envValue('PLEX_BACKUP_MODE') || 'lite'}
            options={['lite', 'full']}
            onChange={(value) => updateEnv('PLEX_BACKUP_MODE', value)}
          />
          <Select
            label="Plex"
            value={envValue('PLEX_INSTALL_MODE') || 'native'}
            options={['native', 'docker', 'disabled']}
            onChange={(value) => updateEnv('PLEX_INSTALL_MODE', value)}
          />
          <Select
            label="Jellyfin"
            value={envValue('JELLYFIN_INSTALL_MODE') || 'disabled'}
            options={['disabled', 'native', 'docker']}
            onChange={(value) => updateEnv('JELLYFIN_INSTALL_MODE', value)}
          />
          <Path
            label="Jellyfin Config Path"
            value={envValue('JELLYFIN_CONFIG_PATH')}
            onChange={(value) => updateEnv('JELLYFIN_CONFIG_PATH', value)}
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
          <Password
            label="Cloudflare Tunnel Token"
            value={envValue('CLOUDFLARE_TUNNEL_TOKEN')}
            onChange={(value) => updateEnv('CLOUDFLARE_TUNNEL_TOKEN', value)}
          />
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
          <div className={styles.routeEditor}>
            <div className={styles.routeHeader}>
              <span>Cloudflare Routes</span>
              <button onClick={addCloudflareRoute} type="button">
                Add route
              </button>
            </div>
            {cloudflareRoutes.length === 0 && <p>No public routes configured.</p>}
            {cloudflareRoutes.map((route, index) => (
              <div className={styles.routeRow} key={`${route.hostname}-${index}`}>
                <input
                  aria-label="Public hostname"
                  placeholder="request.example.com"
                  value={route.hostname}
                  onChange={(event) => updateCloudflareRoute(index, { hostname: event.target.value })}
                />
                <select
                  aria-label="Stackarr service"
                  value={route.service}
                  onChange={(event) => updateCloudflareRoute(index, { service: event.target.value })}
                >
                  {cloudflareServiceOptions.map((service) => (
                    <option key={service} value={service}>
                      {service}
                    </option>
                  ))}
                </select>
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
                      : 'Rotate token'}
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

      {section === 'general' && (
        <FormGrid>
          <Text label="Timezone" value={envValue('TIMEZONE')} onChange={(value) => updateEnv('TIMEZONE', value)} />
          <Password
            label="API Key"
            value={envValue('STACKARR_API_KEY')}
            onChange={(value) => updateEnv('STACKARR_API_KEY', value)}
          />
          <Select
            label="Authentication"
            value={draftSettings.host.authenticationMethod}
            options={['apikey', 'forms', 'none']}
            onChange={(value) =>
              updateSettings('host', 'authenticationMethod', value as StackarrSettings['host']['authenticationMethod'])
            }
          />
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
            <Check
              label="Anonymous Telemetry"
              checked={draftSettings.telemetry.enabled}
              onChange={updateTelemetryEnabled}
            />
          )}
        </FormGrid>
      )}

      {section === 'general' && draftSettings.ui.showAdvanced && (
        <FormGrid>
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

      <div className={styles.footer}>
        <button onClick={save} type="button">
          {state === 'saving' ? 'Saving...' : 'Save'}
        </button>
        {state === 'saved' && <span>{message || 'Saved'}</span>}
        {state === 'error' && <span className={styles.error}>{message || 'Save failed'}</span>}
      </div>
    </div>
  );
}

function portlessSaveMessage(task: unknown) {
  if (!task || typeof task !== 'object') {
    return 'Saved';
  }

  const status = (task as { status?: unknown }).status;

  if (status === 'blocked') {
    return 'Saved. Open Terminal and run: stackarr portless install.';
  }

  return 'Saved. Portless setup queued.';
}

function cloudflareExposureWarning(routes: CloudflareRoute[]) {
  const services = new Set(routes.map((route) => route.service));
  const hasDownloader = services.has('transmission') || services.has('qbittorrent');
  const routeList = routes.map((route) => `${route.hostname} -> ${route.service}`).join('\n');

  return [
    `Apply ${routes.length} public Cloudflare route${routes.length === 1 ? '' : 's'}?`,
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
  onChange
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
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
  error,
  onChange
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        aria-invalid={Boolean(error)}
        autoComplete="off"
        pattern={isPortablePasswordEnvKey(label) ? '[A-Za-z0-9._-]{8,}' : undefined}
        spellCheck={false}
        title={
          isPortablePasswordEnvKey(label)
            ? `Use at least ${portablePasswordMinimumLength} characters: ${portablePasswordDescription}.`
            : undefined
        }
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && <small>{error}</small>}
    </label>
  );
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
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={styles.check}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function isSecretEnvKey(key: string) {
  return ['PASSWORD', 'TOKEN', 'API_KEY', 'SECRET', 'KEY'].some((fragment) => key.includes(fragment));
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
  if (!value || value === currentValue) {
    return '';
  }

  if (value.length < portablePasswordMinimumLength) {
    return `${humanizePasswordKey(key)} must be at least ${portablePasswordMinimumLength} characters.`;
  }

  if (!portablePasswordPattern.test(value)) {
    return `${humanizePasswordKey(key)} may only use ${portablePasswordDescription}.`;
  }

  return '';
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
        service: String(item?.service ?? 'pulsarr').toLowerCase()
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

'use client';

import type { ServiceConfigField, ServiceConfigModel } from '@stackarr/core';
import { Button, Description, Input, Label, Modal, Switch, TextArea, TextField } from '@stackarr/ui';
import { toast } from '@stackarr/ui/toast';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { stackarrFetch } from './clientApi';
import { icons } from './icons';
import { PathInput } from './PathPicker';
import styles from './ServiceDirectory.module.css';
import { ServiceLogo } from './ServiceLogo';
import {
  loadServiceFavorites,
  readServiceFavorites,
  type ServiceFavorite,
  subscribeServiceFavorites,
  writeServiceFavorites
} from './serviceFavorites';
import { Badge } from './ui';

type DraftValues = Record<string, unknown>;

export function ServiceDirectory({
  configs,
  onServiceOpen,
  variant = 'installed',
  initialService
}: {
  configs: ServiceConfigModel[];
  onServiceOpen?: (config: ServiceConfigModel) => boolean | void;
  variant?: 'installed' | 'catalog' | 'helper';
  initialService?: string;
}) {
  const [items, setItems] = useState(configs);
  const [applyState, setApplyState] = useState<'idle' | 'ready' | 'confirming' | 'queueing' | 'queued'>('idle');
  const [favorites, setFavorites] = useState(() => [] as ReturnType<typeof readServiceFavorites>);

  const favoriteNames = useMemo(() => new Set(favorites.map((favorite) => favorite.name)), [favorites]);
  const orderedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        const pinned = favoriteRank(a, favoriteNames) - favoriteRank(b, favoriteNames);
        return pinned || compareServiceConfigs(a, b);
      }),
    [favoriteNames, items]
  );
  useEffect(() => {
    let active = true;
    loadServiceFavorites()
      .then((next) => {
        if (active) {
          setFavorites(next);
        }
      })
      .catch(() => {
        if (active) {
          setFavorites(readServiceFavorites());
        }
      });

    const unsubscribe = subscribeServiceFavorites(setFavorites);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  function openService(config: ServiceConfigModel) {
    const handled = onServiceOpen?.(config);
    if (!handled) {
      const href = serviceLink(config.service);
      if (href) window.open(href, '_blank', 'noopener,noreferrer');
    }
  }

  async function toggleFavorite(config: ServiceConfigModel) {
    const serviceUrl = serviceLink(config.service);

    if (!serviceUrl) {
      return;
    }

    const isFavorite = favoriteNames.has(config.service.name);
    const previous = favorites;
    const nextNames = isFavorite
      ? favorites.map((favorite) => favorite.name).filter((name) => name !== config.service.name)
      : [...favorites.map((favorite) => favorite.name), config.service.name];
    const next = isFavorite
      ? favorites.filter((favorite) => favorite.name !== config.service.name)
      : [...favorites, favoriteFromService(config.service)];

    setFavorites(next);

    try {
      await writeServiceFavorites(nextNames);
      toast.success(`${config.service.displayName} ${isFavorite ? 'unpinned' : 'pinned'}.`);
    } catch (error) {
      setFavorites(previous);
      const errorMessage = error instanceof Error ? error.message : 'Could not update pinned apps.';
      toast.error(errorMessage);
    }
  }

  async function applyChanges() {
    setApplyState('queueing');
    const toastId = toast.loading('Applying app changes…');
    const response = await stackarrFetch('/api/v1/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'StackConfigure', confirmed: true })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setApplyState('ready');
      toast.error(typeof body.message === 'string' ? body.message : 'App changes could not be queued.', {
        id: toastId
      });
      return;
    }
    setApplyState('queued');
    toast.success('App changes queued. Follow progress in Activity.', { id: toastId });
  }

  return (
    <>
      {applyState !== 'idle' && (
        <div className={styles.applyNotice} role={applyState === 'confirming' ? 'alert' : 'status'}>
          <div>
            <strong>
              {applyState === 'queued'
                ? 'App update queued'
                : applyState === 'confirming'
                  ? 'Apply these changes now?'
                  : 'App changes are ready'}
            </strong>
            <small>
              {applyState === 'queued'
                ? 'Follow the update in Activity. Stackarr will keep your saved settings.'
                : applyState === 'confirming'
                  ? 'Stackarr will update this homelab’s containers. Existing app data and volumes stay in place.'
                  : 'Apply once to add, remove, or update the selected app containers.'}
            </small>
          </div>
          <div className={styles.applyActions}>
            {applyState === 'confirming' && (
              <Button onPress={() => setApplyState('ready')} size="sm" variant="tertiary">
                Not now
              </Button>
            )}
            {applyState !== 'queued' && (
              <Button
                isPending={applyState === 'queueing'}
                onPress={applyState === 'confirming' ? applyChanges : () => setApplyState('confirming')}
                size="sm"
                variant="primary"
              >
                {applyState === 'confirming' ? 'Confirm and apply' : 'Review and apply'}
              </Button>
            )}
          </div>
        </div>
      )}
      <div className={styles.directory}>
        {orderedItems.map((config) => {
          const link = serviceLink(config.service);
          const canOpen = config.service.mode !== 'disabled' && Boolean(link || onServiceOpen);
          const canFavorite = variant === 'installed' && config.service.mode !== 'disabled' && Boolean(link);
          const isFavorite = favoriteNames.has(config.service.name);
          const requirementMet = config.service.requirement?.satisfied ?? true;
          const isAvailable = config.service.mode === 'disabled';

          return (
            <article
              key={config.service.name}
              className={`${styles.card} ${config.service.mode === 'disabled' ? styles.disabled : ''}`}
            >
              <div className={styles.logoCell}>
                <ServiceLogo name={config.service.name} size={36} />
              </div>
              <div className={styles.cardBody}>
                <div className={styles.cardTitle}>
                  <strong>{config.service.displayName}</strong>
                  <span className={styles.cardBadges}>
                    <Badge tone={requirementMet ? badgeTone(config.service.status) : 'warn'}>
                      {requirementMet ? serviceStateLabel(config.service.status, variant) : 'Unavailable'}
                    </Badge>
                  </span>
                </div>
                <p>{config.service.description}</p>
                <span>
                  {!requirementMet ? config.service.requirement?.message : (link ?? experienceLabel(config.service))}
                </span>
              </div>
              <div className={styles.cardActions}>
                {canOpen && (
                  <Button
                    className={styles.openButton}
                    onPress={() => openService(config)}
                    size="sm"
                    variant="tertiary"
                  >
                    <icons.open aria-hidden="true" size={14} />
                    <span>Open</span>
                  </Button>
                )}
                {variant === 'installed' && (
                  <Button
                    aria-label={`${isFavorite ? 'Unpin' : 'Pin'} ${config.service.displayName}`}
                    aria-pressed={isFavorite}
                    className={`${styles.pinButton} ${isFavorite ? styles.pinned : ''}`}
                    isDisabled={!canFavorite}
                    isIconOnly
                    onPress={() => toggleFavorite(config)}
                    size="sm"
                    variant="tertiary"
                  >
                    <icons.pin aria-hidden="true" size={15} />
                  </Button>
                )}
                {config.groups.length > 0 && (
                  <ServiceSettingsModal
                    config={config}
                    isAvailable={isAvailable}
                    requestedOpen={initialService === config.service.name}
                    requirementMet={requirementMet}
                    onSaved={(nextConfig, runtimeApplyQueued) => {
                      setItems((current) =>
                        current.map((item) => (item.service.name === nextConfig.service.name ? nextConfig : item))
                      );
                      setApplyState(runtimeApplyQueued ? 'queued' : 'ready');
                    }}
                  />
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function ServiceSettingsModal({
  config,
  isAvailable,
  requestedOpen,
  requirementMet,
  onSaved
}: {
  config: ServiceConfigModel;
  isAvailable: boolean;
  requestedOpen: boolean;
  requirementMet: boolean;
  onSaved: (config: ServiceConfigModel, runtimeApplyQueued: boolean) => void;
}) {
  const [draft, setDraft] = useState<DraftValues>(() => valuesFromConfig(config));
  const [currentPassword, setCurrentPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const setModalState = useCallback((nextOpen: boolean) => {
    setModalOpen(nextOpen);
    if (!nextOpen) {
      setCurrentPassword('');
      setError('');
    }
  }, []);
  const openModal = useCallback(() => setModalState(true), [setModalState]);
  const closeModal = useCallback(() => setModalState(false), [setModalState]);
  const commonGroups = filterConfigGroups(
    config.groups,
    (field, group) => group.title === 'Metadata Providers' || !isAdvancedField(field)
  );
  const advancedGroups = filterConfigGroups(
    config.groups,
    (field, group) => group.title !== 'Metadata Providers' && isAdvancedField(field)
  );
  const currentPasswordRequired = Boolean(
    config.currentPasswordRequiredForProtectedChanges && protectedDraftChangeRequiresCurrentPassword(config, draft)
  );

  useEffect(() => {
    setDraft(valuesFromConfig(config));
  }, [config]);

  useEffect(() => {
    if (requestedOpen && requirementMet) {
      openModal();
    }
  }, [requestedOpen, requirementMet, openModal]);

  function updateDraft(field: ServiceConfigField, value: unknown) {
    setDraft((current) => ({ ...current, [field.id]: value }));
  }

  function close() {
    closeModal();
    setCurrentPassword('');
    setError('');
  }

  async function save() {
    const normalized = normalizeDraft(config, draft);
    if (normalized.error) {
      setError(normalized.error);
      return;
    }

    if (currentPasswordRequired && !currentPassword.trim()) {
      setError('Enter the current admin password to change protected settings.');
      return;
    }

    setSaving(true);
    setError('');
    const response = await stackarrFetch(`/api/v1/services/config/${config.service.name}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ values: normalized.values, currentPassword: currentPassword || undefined })
    });
    const body = await response.json().catch(() => ({}));
    setSaving(false);

    if (!response.ok || body.accepted === false) {
      setError(
        typeof body.error === 'string'
          ? body.error
          : typeof body.message === 'string'
            ? body.message
            : 'Could not save these app settings.'
      );
      return;
    }

    const nextConfig = body.config as ServiceConfigModel | undefined;
    if (nextConfig) {
      onSaved(nextConfig, Boolean(body.runtimeApplyTask));
    }
    const runtimeApplyTargets = Array.isArray(body.runtimeApplyTargets)
      ? body.runtimeApplyTargets.filter((target: unknown): target is string => typeof target === 'string')
      : [];
    toast.success(
      body.runtimeApplyTask
        ? `${config.service.displayName} settings saved. Container update queued for ${runtimeApplyTargets.join(', ')}.`
        : `${config.service.displayName} settings saved.`
    );
    close();
  }

  return (
    <Modal isOpen={modalOpen} onOpenChange={setModalState}>
      <Button
        aria-label={
          requirementMet
            ? `${isAvailable ? 'Add' : 'Configure'} ${config.service.displayName}`
            : config.service.requirement?.message
        }
        className={styles.configButton}
        isDisabled={!requirementMet}
        size="sm"
        variant="secondary"
      >
        {isAvailable ? <span aria-hidden="true">+</span> : <icons.sliders aria-hidden="true" size={15} />}
        <span>{isAvailable ? 'Add' : 'Settings'}</span>
      </Button>
      <Modal.Backdrop variant="blur">
        <Modal.Container placement="center" scroll="inside" size="lg">
          <Modal.Dialog className={styles.modal}>
            <Modal.CloseTrigger aria-label="Close app settings" className={styles.closeButton} />
            <Modal.Header className={styles.modalHeader}>
              <div className={styles.modalTitle}>
                <ServiceLogo name={config.service.name} size={38} />
                <div>
                  <Modal.Heading>
                    {isAvailable ? `Add ${config.service.displayName}` : `${config.service.displayName} settings`}
                  </Modal.Heading>
                  <p>{config.service.description}</p>
                </div>
              </div>
            </Modal.Header>

            <Modal.Body className={styles.modalBody}>
              <AppAccessSettings key={config.service.name} config={config} enabled={modalOpen} />
              <ConfigGroups groups={commonGroups} draft={draft} onChange={updateDraft} />
              {advancedGroups.length > 0 && (
                <details className={styles.advancedSettings}>
                  <summary>
                    <span>Advanced app settings</span>
                    <small>Images, ports, databases, and credentials</small>
                  </summary>
                  <div className={styles.advancedBody}>
                    <ConfigGroups groups={advancedGroups} draft={draft} onChange={updateDraft} />
                  </div>
                </details>
              )}
              {currentPasswordRequired && (
                <section className={styles.currentPasswordGate}>
                  <TextField className={styles.textField} fullWidth>
                    <Label>Current admin password</Label>
                    <Input
                      autoComplete="current-password"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                  </TextField>
                </section>
              )}
            </Modal.Body>

            <Modal.Footer className={styles.modalFooter}>
              {error && <span className={styles.error}>{error}</span>}
              <Button onPress={close} variant="tertiary">
                Cancel
              </Button>
              <Button isPending={saving} onPress={save} variant="primary">
                {isAvailable ? 'Save app' : 'Save changes'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function ConfigGroups({
  groups,
  draft,
  onChange
}: {
  groups: ServiceConfigModel['groups'];
  draft: DraftValues;
  onChange: (field: ServiceConfigField, value: unknown) => void;
}) {
  return groups.map((group) => (
    <section key={group.title} className={styles.group}>
      <h3>{group.title}</h3>
      {group.description && <p>{group.description}</p>}
      <div className={styles.fields}>
        {group.fields.map((field) => (
          <FieldEditor
            key={field.id}
            field={field}
            savedPreview={field.secret && field.value ? String(field.value) : undefined}
            value={draft[field.id]}
            onChange={(value) => onChange(field, value)}
          />
        ))}
      </div>
    </section>
  ));
}

type AppAccessState = {
  supported: boolean;
  target: string;
  route: { hostname: string; service: string; access?: boolean } | null;
  access: { enabled: boolean };
  tunnelConfigured: boolean;
};

function AppAccessSettings({ config, enabled }: { config: ServiceConfigModel; enabled: boolean }) {
  const [state, setState] = useState<AppAccessState | null>(null);
  const [hostname, setHostname] = useState('');
  const [protect, setProtect] = useState(config.service.name !== 'immich');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const href = serviceLink(config.service);

  useEffect(() => {
    if (!enabled || state) {
      return undefined;
    }

    let mounted = true;
    void stackarrFetch(`/api/v1/services/access/${config.service.name}`, { cache: 'no-store' })
      .then(async (response) => (response.ok ? ((await response.json()) as AppAccessState) : null))
      .then((next) => {
        if (!mounted || !next) return;
        setState(next);
        setHostname(next.route?.hostname ?? '');
        setProtect(next.route?.access ?? config.service.name !== 'immich');
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [config.service.name, enabled, state]);

  async function saveAccess() {
    const normalizedHostname = hostname.trim();
    if (
      normalizedHostname &&
      !window.confirm(
        `Publish ${config.service.displayName} at ${normalizedHostname}${protect ? ' and protect it with Cloudflare Access' : ''}?`
      )
    ) {
      return;
    }

    setSaving(true);
    setMessage('');
    const response = await stackarrFetch(`/api/v1/services/access/${config.service.name}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostname: normalizedHostname, access: protect })
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.accepted === false) {
      setSaving(false);
      setMessage(body.error ?? 'Could not save this app route.');
      return;
    }

    const applyResponse = await stackarrFetch('/api/v1/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'CloudflareApplyRoutes', confirmed: true })
    });
    setSaving(false);
    setState((current) => (current ? { ...current, route: body.route ?? null } : current));
    setMessage(
      applyResponse.ok
        ? normalizedHostname
          ? 'Public route saved and queued.'
          : 'Public route removal queued.'
        : 'Route saved, but it could not be applied. Open Remote access to retry.'
    );
  }

  return (
    <section className={styles.accessPanel}>
      <div className={styles.accessHeading}>
        <div>
          <h3 className="m-0 text-sm font-semibold">Open and connect</h3>
          <p className="m-0 text-xs leading-relaxed text-muted">
            Stable local links and optional remote access for this app.
          </p>
        </div>
        {href && (
          <a href={href} rel="noreferrer" target="_blank">
            <icons.open aria-hidden="true" size={14} /> Open app
          </a>
        )}
      </div>
      {href && <code className={styles.appUrl}>{href}</code>}
      {state?.supported && (
        <div className={styles.tunnelEditor}>
          <TextField className={styles.textField} fullWidth>
            <Label>Public hostname</Label>
            <Input
              placeholder={`${config.service.name}.example.com`}
              value={hostname}
              onChange={(event) => setHostname(event.target.value)}
            />
            <Description>Leave empty to remove this app from the Cloudflare tunnel.</Description>
          </TextField>
          <Switch className={styles.switchField} isSelected={protect} onChange={setProtect}>
            <Switch.Content>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <Label>Require Cloudflare Access</Label>
            </Switch.Content>
            <Description>Ask approved users to sign in before this app opens remotely.</Description>
          </Switch>
          <Button className={styles.routeButton} isDisabled={saving} onPress={saveAccess} size="sm" variant="secondary">
            <icons.cloud aria-hidden="true" size={14} />
            {saving ? 'Applying…' : state.route ? 'Update route' : 'Add route'}
          </Button>
        </div>
      )}
      {state && !state.tunnelConfigured && (
        <p className={styles.accessNote}>
          Add Cloudflare credentials in <a href="/settings/connect">Remote access</a> before applying a public route.
        </p>
      )}
      {state && !state.supported && (
        <p className={styles.accessNote}>This internal helper stays private and is reached through its parent app.</p>
      )}
      {message && <p className={styles.accessNote}>{message}</p>}
    </section>
  );
}

function serviceLink(service: ServiceConfigModel['service']) {
  return service.browserUrl ?? service.localUrl;
}

function favoriteFromService(service: ServiceConfigModel['service']): ServiceFavorite {
  return {
    name: service.name,
    displayName: service.displayName,
    localUrl: service.localUrl,
    browserUrl: service.browserUrl
  };
}

function FieldEditor({
  field,
  savedPreview,
  value,
  onChange
}: {
  field: ServiceConfigField;
  savedPreview?: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.type === 'checkbox') {
    return (
      <Switch className={styles.switchField} isSelected={truthy(value)} onChange={onChange}>
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
          <Label>{field.label}</Label>
        </Switch.Content>
        {field.description && <Description>{field.description}</Description>}
      </Switch>
    );
  }

  if (field.type === 'json') {
    return (
      <TextField className={styles.textField} fullWidth>
        <Label>{field.label}</Label>
        <TextArea
          className={styles.jsonInput}
          placeholder={savedPreview}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          spellCheck={false}
        />
        {field.description && <Description>{field.description}</Description>}
      </TextField>
    );
  }

  if (field.type === 'path') {
    return (
      <div className={styles.textField}>
        <span className={styles.fieldLabel}>{field.label}</span>
        <PathInput value={String(value ?? '')} onChange={onChange} />
        {field.description && <small>{field.description}</small>}
      </div>
    );
  }

  return (
    <TextField className={styles.textField} fullWidth>
      <Label>{field.label}</Label>
      {field.type === 'select' ? (
        <select value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <Input
          autoComplete={field.type === 'password' ? 'off' : undefined}
          placeholder={savedPreview}
          spellCheck={field.type === 'password' ? false : undefined}
          type={field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : 'text'}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.description && <Description>{field.description}</Description>}
    </TextField>
  );
}

function valuesFromConfig(config: ServiceConfigModel): DraftValues {
  const values: DraftValues = {};

  for (const group of config.groups) {
    for (const field of group.fields) {
      values[field.id] = field.secret
        ? ''
        : field.type === 'json'
          ? JSON.stringify(field.value ?? {}, null, 2)
          : field.value;
    }
  }

  return values;
}

function normalizeDraft(config: ServiceConfigModel, draft: DraftValues): { values: DraftValues; error?: string } {
  const values: DraftValues = {};

  for (const group of config.groups) {
    for (const field of group.fields) {
      const value = draft[field.id];

      if (field.secret && !String(value ?? '').trim()) {
        continue;
      }

      if (field.type === 'json') {
        try {
          values[field.id] = value ? JSON.parse(String(value)) : {};
        } catch {
          return { values, error: `${field.label} is not valid JSON.` };
        }
      } else if (field.type === 'checkbox') {
        values[field.id] = truthy(value);
      } else if (field.type === 'number') {
        values[field.id] = Number(value) || 0;
      } else {
        values[field.id] = value;
      }
    }
  }

  return { values };
}

function protectedDraftChangeRequiresCurrentPassword(config: ServiceConfigModel, draft: DraftValues) {
  for (const group of config.groups) {
    for (const field of group.fields) {
      if (!field.protected) {
        continue;
      }

      const value = draft[field.id];
      if (field.secret) {
        if (String(value ?? '').trim()) {
          return true;
        }
        continue;
      }

      if (!sameDraftValue(field, value, field.value)) {
        return true;
      }
    }
  }

  return false;
}

function sameDraftValue(field: ServiceConfigField, draftValue: unknown, savedValue: unknown) {
  if (field.type === 'checkbox') {
    return truthy(draftValue) === truthy(savedValue);
  }

  if (field.type === 'number') {
    return (Number(draftValue) || 0) === (Number(savedValue) || 0);
  }

  return String(draftValue ?? '') === String(savedValue ?? '');
}

function truthy(value: unknown) {
  if (typeof value === 'boolean') {
    return value;
  }

  return /^(1|true|yes|on)$/i.test(String(value ?? ''));
}

function filterConfigGroups(
  groups: ServiceConfigModel['groups'],
  include: (field: ServiceConfigField, group: ServiceConfigModel['groups'][number]) => boolean
): ServiceConfigModel['groups'] {
  return groups
    .map((group) => ({ ...group, fields: group.fields.filter((field) => include(field, group)) }))
    .filter((group) => group.fields.length > 0);
}

function isAdvancedField(field: ServiceConfigField) {
  const id = field.id.toLowerCase();
  const label = field.label.toLowerCase();
  return [
    'image',
    'bindip',
    'containerport',
    'database',
    'postgres',
    'redis',
    'jwt',
    'secret',
    'cors',
    'loglevel',
    'preset',
    'override',
    'cloudflare',
    'queryjson'
  ].some((term) => id.includes(term) || label.replaceAll(' ', '').includes(term));
}

function compareServiceConfigs(a: ServiceConfigModel, b: ServiceConfigModel) {
  const disabledDifference = disabledRank(a) - disabledRank(b);

  if (disabledDifference !== 0) {
    return disabledDifference;
  }

  const rankDifference = serviceRank(a) - serviceRank(b);

  if (rankDifference !== 0) {
    return rankDifference;
  }

  const categoryDifference = a.service.category.localeCompare(b.service.category);

  if (categoryDifference !== 0) {
    return categoryDifference;
  }

  if (a.service.category === 'media') {
    const mediaDifference = mediaRank(a.service.name) - mediaRank(b.service.name);

    if (mediaDifference !== 0) {
      return mediaDifference;
    }
  }

  const kindDifference = kindRank(a.service.kind) - kindRank(b.service.kind);

  if (kindDifference !== 0) {
    return kindDifference;
  }

  return a.service.displayName.localeCompare(b.service.displayName, undefined, {
    numeric: true,
    sensitivity: 'base'
  });
}

function serviceRank(config: ServiceConfigModel) {
  if (config.service.name === 'stackarr') {
    return 0;
  }

  if (config.service.category === 'media') {
    return 1;
  }

  return 2;
}

function disabledRank(config: ServiceConfigModel) {
  return config.service.mode === 'disabled' ? 1 : 0;
}

function kindRank(kind: ServiceConfigModel['service']['kind']) {
  if (kind === 'container') {
    return 0;
  }

  if (kind === 'app') {
    return 1;
  }

  return 2;
}

function mediaRank(name: string) {
  if (name === 'plex') {
    return 0;
  }

  if (name === 'jellyfin') {
    return 1;
  }

  return 2;
}

function favoriteRank(config: ServiceConfigModel, favorites: Set<string>) {
  return favorites.has(config.service.name) ? 0 : 1;
}

function serviceStateLabel(status: string, variant: 'installed' | 'catalog' | 'helper') {
  if (variant === 'catalog' && status === 'disabled') return 'Available';
  if (status === 'configured') return 'Ready';
  if (status === 'missing') return 'Needs setup';
  if (status === 'disabled') return 'Off';
  return 'Check status';
}

function experienceLabel(service: ServiceConfigModel['service']) {
  if (service.experience === 'helper') return 'Works in the background';
  if (service.category === 'download') return 'Downloads';
  if (service.category === 'media') return 'Library and playback';
  if (service.category === 'servarr') return 'Library automation';
  return 'Homelab app';
}

function badgeTone(status: string): 'good' | 'warn' | 'bad' | 'purple' | 'neutral' {
  if (status === 'configured') return 'good';
  if (status === 'disabled') return 'warn';
  if (status === 'missing') return 'bad';
  return 'neutral';
}

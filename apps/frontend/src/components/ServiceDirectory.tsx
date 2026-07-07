'use client';

import type { ServiceConfigField, ServiceConfigModel } from '@stackarr/core';
import { toast } from '@stackarr/ui/toast';
import { type MouseEvent, useEffect, useMemo, useState } from 'react';
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
  onServiceOpen
}: {
  configs: ServiceConfigModel[];
  onServiceOpen?: (config: ServiceConfigModel) => boolean | void;
}) {
  const [items, setItems] = useState(configs);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftValues>({});
  const [currentPassword, setCurrentPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [favorites, setFavorites] = useState(() => [] as ReturnType<typeof readServiceFavorites>);

  const active = useMemo(() => items.find((item) => item.service.name === activeName) ?? null, [activeName, items]);
  const orderedItems = useMemo(() => [...items].sort(compareServiceConfigs), [items]);
  const favoriteNames = useMemo(() => new Set(favorites.map((favorite) => favorite.name)), [favorites]);
  const currentPasswordRequired = Boolean(
    active?.currentPasswordRequiredForProtectedChanges && protectedDraftChangeRequiresCurrentPassword(active, draft)
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

  function openConfig(config: ServiceConfigModel) {
    setActiveName(config.service.name);
    setDraft(valuesFromConfig(config));
    setCurrentPassword('');
    setError('');
  }

  function closeConfig() {
    setActiveName(null);
    setCurrentPassword('');
    setError('');
  }

  function updateDraft(field: ServiceConfigField, value: unknown) {
    setDraft((current) => ({ ...current, [field.id]: value }));
  }

  async function toggleFavorite(config: ServiceConfigModel, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();

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
      toast.success(`${config.service.displayName} ${isFavorite ? 'removed from' : 'added to'} favorites.`);
    } catch (error) {
      setFavorites(previous);
      const errorMessage = error instanceof Error ? error.message : 'Could not save favorite services.';
      setError(errorMessage);
      toast.error(errorMessage);
    }
  }

  async function save() {
    if (!active) {
      return;
    }

    const payload = normalizeDraft(active, draft);

    if (payload.error) {
      setError(payload.error);
      toast.error(payload.error);
      return;
    }

    if (currentPasswordRequired && !currentPassword.trim()) {
      const message = 'Current admin password is required to change protected account or secret fields.';
      setError(message);
      toast.error(message);
      return;
    }

    setSaving(true);
    setError('');
    const toastId = toast.loading(`Saving ${active.service.displayName} settings...`);

    const response = await stackarrFetch(`/api/v1/services/config/${active.service.name}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        values: payload.values,
        ...(currentPasswordRequired ? { currentPassword } : {})
      })
    });
    const body = await response.json().catch(() => ({}));

    setSaving(false);

    if (!response.ok || body.accepted === false) {
      const errorMessage = body.error ?? body.message ?? 'Save failed';
      setError(errorMessage);
      toast.error(errorMessage, { id: toastId });
      return;
    }

    const nextConfig = body.config as ServiceConfigModel;
    setItems((current) => current.map((item) => (item.service.name === nextConfig.service.name ? nextConfig : item)));
    closeConfig();
    toast.success(`${active.service.displayName} settings saved.`, { id: toastId });
  }

  return (
    <>
      <div className={styles.directory}>
        {orderedItems.map((config) => {
          const link = serviceLink(config.service);
          const hasCustomOpen = Boolean(onServiceOpen);
          const canOpen = config.service.mode !== 'disabled' && (hasCustomOpen || Boolean(link));
          const canFavorite = config.service.mode !== 'disabled' && Boolean(link);
          const isFavorite = favoriteNames.has(config.service.name);

          return (
            <article
              key={config.service.name}
              className={`${styles.card} ${config.service.mode === 'disabled' ? styles.disabled : ''}`}
              title={canOpen ? (hasCustomOpen ? `Open ${config.service.displayName}` : `Open ${link}`) : undefined}
              role={hasCustomOpen ? 'button' : undefined}
              tabIndex={hasCustomOpen && canOpen ? 0 : undefined}
              onClick={hasCustomOpen && canOpen ? () => onServiceOpen?.(config) : undefined}
              onKeyDown={
                hasCustomOpen && canOpen
                  ? (event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onServiceOpen?.(config);
                      }
                    }
                  : undefined
              }
            >
              {canOpen && !hasCustomOpen && (
                <a
                  aria-label={`Open ${config.service.displayName} at ${link}`}
                  className={styles.stretchedLink}
                  href={link}
                  rel="noreferrer"
                  target="_blank"
                />
              )}
              <div className={styles.logoCell}>
                <ServiceLogo name={config.service.name} size={36} />
              </div>
              <div className={styles.cardBody}>
                <div className={styles.cardTitle}>
                  <strong>{config.service.displayName}</strong>
                  <span className={styles.cardBadges}>
                    <Badge tone="neutral">{config.service.kind}</Badge>
                    <Badge tone={badgeTone(config.service.status)}>{config.service.status}</Badge>
                  </span>
                </div>
                <p>{config.service.description}</p>
                <span>{link ?? config.service.category}</span>
              </div>
              <div className={styles.cardActions}>
                <button
                  aria-label={`${isFavorite ? 'Remove' : 'Add'} ${config.service.displayName} ${isFavorite ? 'from' : 'to'} favorites`}
                  aria-pressed={isFavorite}
                  className={`${styles.starButton} ${isFavorite ? styles.starred : ''}`}
                  disabled={!canFavorite}
                  onClick={(event) => toggleFavorite(config, event)}
                  type="button"
                  title={
                    canFavorite
                      ? `${isFavorite ? 'Unstar' : 'Star'} ${config.service.displayName}`
                      : 'Add a local URL before starring'
                  }
                >
                  {isFavorite ? (
                    <icons.starSolid aria-hidden="true" size={15} />
                  ) : (
                    <icons.star aria-hidden="true" size={15} />
                  )}
                </button>
                {config.groups.length > 0 && (
                  <button
                    className={styles.configButton}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      openConfig(config);
                    }}
                    type="button"
                    title={`Configure ${config.service.displayName}`}
                  >
                    <icons.sliders aria-hidden="true" size={15} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {active && (
        <div className={styles.overlay} role="presentation" onMouseDown={closeConfig}>
          <section
            aria-modal="true"
            className={styles.modal}
            role="dialog"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className={styles.modalHeader}>
              <div>
                <h2>Configure {active.service.displayName}</h2>
                <p>{active.service.description}</p>
              </div>
              <button className={styles.closeButton} onClick={closeConfig} type="button" aria-label="Close">
                x
              </button>
            </header>

            <div className={styles.modalBody}>
              {active.groups.map((group) => (
                <section key={group.title} className={styles.group}>
                  <h3>{group.title}</h3>
                  {group.description && <p>{group.description}</p>}
                  <div className={styles.fields}>
                    {group.fields.map((field) => (
                      <FieldEditor
                        key={field.id}
                        field={field}
                        saved={Boolean(field.secret && field.value)}
                        value={draft[field.id]}
                        onChange={(value) => updateDraft(field, value)}
                      />
                    ))}
                  </div>
                </section>
              ))}
              {currentPasswordRequired && (
                <section className={styles.currentPasswordGate}>
                  <label className={styles.field}>
                    <span>Current admin password</span>
                    <input
                      autoComplete="current-password"
                      type="password"
                      value={currentPassword}
                      onChange={(event) => setCurrentPassword(event.target.value)}
                    />
                  </label>
                </section>
              )}
            </div>

            <footer className={styles.modalFooter}>
              {error && <span className={styles.error}>{error}</span>}
              <button onClick={closeConfig} type="button">
                Cancel
              </button>
              <button className={styles.primary} disabled={saving} onClick={save} type="button">
                {saving ? 'Saving...' : 'Save'}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
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
  saved,
  value,
  onChange
}: {
  field: ServiceConfigField;
  saved?: boolean;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  if (field.type === 'checkbox') {
    return (
      <label className={styles.check}>
        <input type="checkbox" checked={truthy(value)} onChange={(event) => onChange(event.target.checked)} />
        <span>{field.label}</span>
        {field.description && <small>{field.description}</small>}
      </label>
    );
  }

  return (
    <label className={field.type === 'json' ? styles.jsonField : styles.field}>
      <span>{field.label}</span>
      {field.type === 'select' ? (
        <select value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : field.type === 'json' ? (
        <textarea value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} spellCheck={false} />
      ) : field.type === 'path' ? (
        <PathInput value={String(value ?? '')} onChange={onChange} />
      ) : (
        <input
          autoComplete={field.type === 'password' ? 'off' : undefined}
          placeholder={saved ? 'Saved' : undefined}
          spellCheck={field.type === 'password' ? false : undefined}
          type={field.type === 'number' ? 'number' : field.type === 'password' ? 'password' : 'text'}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.description && <small>{field.description}</small>}
    </label>
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

function badgeTone(status: string): 'good' | 'warn' | 'bad' | 'purple' | 'neutral' {
  if (status === 'configured') return 'good';
  if (status === 'disabled') return 'warn';
  if (status === 'missing') return 'bad';
  return 'neutral';
}

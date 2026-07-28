'use client';

import type { AgregarrManager as AgregarrManagerState, AgregarrMediaScope, AgregarrPreset } from '@stackarr/core';
import { Button, Label, Skeleton, Switch } from '@stackarr/ui';
import { toast } from '@stackarr/ui/toast';
import { useEffect, useState } from 'react';
import styles from './AgregarrManager.module.css';
import { stackarrFetch } from './clientApi';

const presets: Array<{ id: AgregarrPreset; name: string; detail: string; source: string }> = [
  {
    id: 'coming-soon',
    name: 'Coming Soon',
    detail: 'Monitored Radarr releases and the next undownloaded Sonarr season premieres, ordered by availability.',
    source: 'Your Arr apps'
  },
  {
    id: 'tmdb-trending',
    name: 'Trending This Week',
    detail: 'A fresh weekly discovery row from TMDb with home-order rotation enabled.',
    source: 'TMDb'
  },
  {
    id: 'imdb-popular',
    name: 'IMDb Popular',
    detail: 'Popular movie and TV meter titles from IMDb, refreshed by Agregarr.',
    source: 'IMDb'
  }
];

export function AgregarrManager({
  initialManager,
  initialError
}: {
  initialManager?: AgregarrManagerState | null;
  initialError?: string;
} = {}) {
  const [manager, setManager] = useState(initialManager);
  const [loadError, setLoadError] = useState(initialError ?? '');
  const [loading, setLoading] = useState(initialManager === undefined);
  const [preset, setPreset] = useState<AgregarrPreset>('coming-soon');
  const [mediaScope, setMediaScope] = useState<AgregarrMediaScope>('both');
  const [maxItems, setMaxItems] = useState(100);
  const [daysAhead, setDaysAhead] = useState(730);
  const [pending, setPending] = useState('');

  useEffect(() => {
    if (initialManager !== undefined) {
      return undefined;
    }

    let mounted = true;
    void stackarrFetch('/api/v1/apps/agregarr', { cache: 'no-store' })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as AgregarrManagerState & { message?: string };
        if (!response.ok) {
          throw new Error(body.message || 'Agregarr is not connected yet.');
        }
        if (mounted) {
          setManager(body);
        }
      })
      .catch((error) => {
        if (mounted) {
          setLoadError(error instanceof Error ? error.message : 'Agregarr is not connected yet.');
        }
      })
      .finally(() => {
        if (mounted) {
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [initialManager]);

  async function perform(label: string, body: Record<string, unknown>) {
    setPending(label);
    const toastId = toast.loading(`${label}…`);
    try {
      const response = await stackarrFetch('/api/v1/apps/agregarr', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = (await response.json().catch(() => ({}))) as Partial<AgregarrManagerState> & { message?: string };
      if (!response.ok) throw new Error(result.message || 'The Agregarr action failed.');
      setManager(result as AgregarrManagerState);
      toast.success(`${label} complete.`, { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The Agregarr action failed.', { id: toastId });
    } finally {
      setPending('');
    }
  }

  if (loading) {
    return (
      <div className={`${styles.loading} skeleton--shimmer`} aria-label="Loading Collection Studio">
        <Skeleton className={styles.loadingStatus} animationType="none" />
        <div className={styles.loadingCards}>
          <Skeleton animationType="none" />
          <Skeleton animationType="none" />
          <Skeleton animationType="none" />
        </div>
      </div>
    );
  }

  if (!manager) {
    return (
      <div className={styles.setupState}>
        <img alt="" height="44" src="/logos/agregarr.svg" width="45" />
        <div>
          <strong>Agregarr needs its Stackarr connection</strong>
          <p>{loadError || 'Apply setup once to connect Plex and save Agregarr’s generated API key.'}</p>
        </div>
        <a href="/stack/services?app=agregarr">Open settings</a>
      </div>
    );
  }

  const selectedPreset = presets.find((item) => item.id === preset) ?? presets[0];
  return (
    <div className={styles.manager}>
      <header className={styles.statusBar}>
        <div className={styles.identity}>
          <span className={styles.logoWell}>
            <img alt="" height="35" src="/logos/agregarr.svg" width="36" />
          </span>
          <div>
            <span>Agregarr {manager.version ? `v${manager.version}` : ''}</span>
            <strong>{manager.plexServerName || 'Plex connection pending'}</strong>
          </div>
        </div>
        <div className={styles.metrics}>
          <span>
            <strong>{manager.groups.length}</strong> sources
          </span>
          <span>
            <strong>{manager.libraries.length}</strong> libraries
          </span>
          <span className={manager.ready ? styles.ready : styles.warning}>
            {manager.ready ? 'Ready' : 'Needs setup'}
          </span>
        </div>
      </header>

      <section className={styles.studio} aria-labelledby="collection-source-title">
        <div className={styles.sectionIntro}>
          <div>
            <span className={styles.eyebrow}>Collection source</span>
            <h3 id="collection-source-title">Add something useful</h3>
          </div>
          <p>Stackarr creates linked movie and TV rows when both libraries are selected.</p>
        </div>

        <div className={styles.presetGrid}>
          {presets.map((item) => (
            <button
              aria-pressed={preset === item.id}
              className={preset === item.id ? styles.presetActive : styles.preset}
              key={item.id}
              onClick={() => setPreset(item.id)}
              type="button"
            >
              <span>{item.source}</span>
              <strong>{item.name}</strong>
              <p>{item.detail}</p>
            </button>
          ))}
        </div>

        <div className={styles.createBar}>
          <fieldset className={styles.segmentField}>
            <legend>Libraries</legend>
            <div className={styles.segments}>
              {(
                [
                  ['movie', 'Movies'],
                  ['tv', 'TV'],
                  ['both', 'Movies + TV']
                ] as const
              ).map(([value, label]) => (
                <button
                  aria-pressed={mediaScope === value}
                  key={value}
                  onClick={() => setMediaScope(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <label className={styles.numberField}>
            <span>Max titles</span>
            <input
              max="200"
              min="10"
              onChange={(event) => setMaxItems(Number(event.target.value))}
              type="number"
              value={maxItems}
            />
          </label>
          {preset === 'coming-soon' && (
            <label className={styles.numberField}>
              <span>Look ahead</span>
              <div>
                <input
                  max="1825"
                  min="30"
                  onChange={(event) => setDaysAhead(Number(event.target.value))}
                  type="number"
                  value={daysAhead}
                />
                <small>days</small>
              </div>
            </label>
          )}
          <Button
            isDisabled={!manager.ready}
            isPending={pending === `Add ${selectedPreset.name}`}
            onPress={() =>
              perform(`Add ${selectedPreset.name}`, {
                action: 'ensure-preset',
                preset,
                mediaScope,
                maxItems,
                daysAhead
              })
            }
            size="sm"
            variant="primary"
          >
            Add or update source
          </Button>
        </div>
      </section>

      <section className={styles.collectionSection} aria-labelledby="managed-collections-title">
        <div className={styles.sectionIntro}>
          <div>
            <span className={styles.eyebrow}>Plex rows</span>
            <h3 id="managed-collections-title">Managed collections</h3>
          </div>
          <p>
            {manager.syncStatus.running
              ? `Syncing ${manager.syncStatus.currentStage || 'collections'}…`
              : manager.syncStatus.lastSyncAt
                ? `Last full sync ${formatTime(manager.syncStatus.lastSyncAt)}`
                : 'No full sync recorded yet'}
          </p>
        </div>
        {manager.groups.length ? (
          <div className={styles.collectionList}>
            {manager.groups.map((group) => (
              <article className={styles.collection} key={group.key}>
                <div className={styles.collectionMain}>
                  <div className={styles.collectionTitle}>
                    <span className={group.needsSync ? styles.syncDot : styles.steadyDot} aria-hidden="true" />
                    <div>
                      <strong>{group.name || 'Untitled collection'}</strong>
                      <p>
                        {sourceLabel(group.type, group.subtype)} · {sortLabel(group.sortOrder)}
                      </p>
                    </div>
                  </div>
                  <div className={styles.libraryChips}>
                    {group.libraries.map((library) => (
                      <span key={`${group.key}:${library.id}`}>
                        {library.mediaType === 'tv' ? 'TV' : 'Movie'} · {library.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className={styles.collectionControls}>
                  <Switch
                    className={styles.compactSwitch}
                    isDisabled={Boolean(pending)}
                    isSelected={group.visibility.serverOwnerHome || group.visibility.usersHome}
                    onChange={(value) =>
                      perform(`Update ${group.name}`, {
                        action: 'update-group',
                        collectionIds: group.ids,
                        showOnHome: value
                      })
                    }
                  >
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      <Label>Home</Label>
                    </Switch.Content>
                  </Switch>
                  <Switch
                    className={styles.compactSwitch}
                    isDisabled={Boolean(pending)}
                    isSelected={group.visibility.libraryRecommended}
                    onChange={(value) =>
                      perform(`Update ${group.name}`, {
                        action: 'update-group',
                        collectionIds: group.ids,
                        recommended: value
                      })
                    }
                  >
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      <Label>Discover</Label>
                    </Switch.Content>
                  </Switch>
                  <Switch
                    className={styles.compactSwitch}
                    isDisabled={Boolean(pending) || group.type === 'comingsoon'}
                    isSelected={group.randomizeHomeOrder}
                    onChange={(value) =>
                      perform(`Update ${group.name}`, {
                        action: 'update-group',
                        collectionIds: group.ids,
                        randomizeHomeOrder: value
                      })
                    }
                  >
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                      <Label>Shuffle</Label>
                    </Switch.Content>
                  </Switch>
                  <Button
                    isPending={pending === `Sync ${group.name}`}
                    onPress={() => perform(`Sync ${group.name}`, { action: 'sync-group', collectionIds: group.ids })}
                    size="sm"
                    variant="secondary"
                  >
                    Sync now
                  </Button>
                </div>
                {(group.lastSyncError || group.lastSyncedAt) && (
                  <p className={group.lastSyncError ? styles.error : styles.lastSync}>
                    {group.lastSyncError || `Last synced ${formatTime(group.lastSyncedAt)}`}
                  </p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.empty}>No managed collections yet. Coming Soon is a good first source.</p>
        )}
      </section>
    </div>
  );
}

function sourceLabel(type?: string, subtype?: string) {
  if (type === 'comingsoon') return 'Monitored in Radarr + Sonarr';
  if (type === 'tmdb') return subtype === 'trending_week' ? 'TMDb trending this week' : 'TMDb';
  if (type === 'imdb') return subtype === 'popular' ? 'IMDb popular meter' : 'IMDb';
  return [type, subtype].filter(Boolean).join(' · ') || 'Agregarr source';
}

function sortLabel(sort?: string) {
  if (sort === 'release_date_asc') return 'release date, soonest first';
  return sort && sort !== 'default' ? sort.replaceAll('_', ' ') : 'source order';
}

function formatTime(value?: string) {
  if (!value) return 'never';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

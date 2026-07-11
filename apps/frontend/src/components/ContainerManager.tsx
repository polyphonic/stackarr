'use client';

import type {
  DockerContainerItem,
  DockerContainerOverview,
  DockerImageItem,
  DockerNetworkItem,
  DockerOverview,
  DockerResourceActionInput,
  DockerVolumeItem
} from '@stackarr/core';
import { toast } from '@stackarr/ui/toast';
import type React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import styles from './ContainerManager.module.css';
import { stackarrFetch } from './clientApi';
import { icons } from './icons';
import { ServiceLogo } from './ServiceLogo';
import { Badge } from './ui';

type TabKey = 'containers' | 'volumes' | 'images' | 'networks';
type SelectedKeys = Partial<Record<TabKey, string>>;
type ActionInput = Pick<DockerResourceActionInput, 'kind' | 'action' | 'id' | 'force' | 'deleteVolumes'>;
type MetricPair = { first: number; second: number };
type MetricHistoryPoint = { at: number; cpu: number; memory: number; network: number };

const tabs: Array<{ key: TabKey; label: string; icon: typeof icons.container }> = [
  { key: 'containers', label: 'Stacks', icon: icons.stack },
  { key: 'volumes', label: 'Volumes', icon: icons.drive },
  { key: 'images', label: 'Images', icon: icons.image },
  { key: 'networks', label: 'Network', icon: icons.network }
];

export function ContainerManager({ overview }: { overview: DockerOverview | DockerContainerOverview }) {
  const [data, setData] = useState(() => normalizeOverview(overview));
  const [advancedLoaded, setAdvancedLoaded] = useState(() => 'volumes' in overview);
  const [tab, setTab] = useState<TabKey>('containers');
  const [selected, setSelected] = useState<SelectedKeys>({});
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(data.error ?? '');
  const [metricHistory, setMetricHistory] = useState<MetricHistoryPoint[]>(() => [metricHistoryPoint(data)]);

  const containerItems = useMemo(
    () => filterItems(data.containers, query, containerSearchText),
    [data.containers, query]
  );
  const volumeItems = useMemo(() => filterItems(data.volumes, query, volumeSearchText), [data.volumes, query]);
  const imageItems = useMemo(() => filterItems(data.images, query, imageSearchText), [data.images, query]);
  const networkItems = useMemo(() => filterItems(data.networks, query, networkSearchText), [data.networks, query]);

  const activeContainer = selected.containers
    ? containerItems.find((item) => containerKey(item) === selected.containers)
    : undefined;
  const activeVolume = selectedItem(volumeItems, selected.volumes, volumeKey);
  const activeImage = selectedItem(imageItems, selected.images, imageKey);
  const activeNetwork = selectedItem(networkItems, selected.networks, networkKey);

  const refresh = useCallback(async (options: { silent?: boolean; full?: boolean } = {}) => {
    if (!options.silent) {
      setBusy('refresh');
    }

    const full = options.full === true;
    const response = await stackarrFetch(full ? '/api/v1/containers' : '/api/v1/containers?scope=containers');
    const body = (await response.json().catch(() => null)) as DockerOverview | DockerContainerOverview | null;

    if (!options.silent) {
      setBusy('');
    }

    if (!response.ok || !body) {
      if (!options.silent) {
        const errorMessage = 'Could not refresh Docker resources.';
        setMessage(errorMessage);
        toast.error(errorMessage);
      }
      return;
    }

    setData((current) => (full ? normalizeOverview(body) : mergeContainerOverview(current, body)));
    if (full) setAdvancedLoaded(true);
    if (!options.silent || body.error) {
      const nextMessage = body.error ?? 'Docker resources refreshed.';
      setMessage(nextMessage);
      toast[body.error ? 'error' : 'success'](nextMessage);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'containers' || !data.dockerAvailable) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh({ silent: true });
      }
    }, 30000);

    return () => window.clearInterval(interval);
  }, [data.dockerAvailable, refresh, tab]);

  useEffect(() => {
    const point = metricHistoryPoint(data);
    setMetricHistory((current) => {
      const withoutDuplicate = current.filter((item) => item.at !== point.at);
      return [...withoutDuplicate, point].slice(-40);
    });
  }, [data]);

  async function runAction(input: ActionInput, label: string) {
    const destructive = isDestructive(input);

    if (destructive && !window.confirm(label)) {
      return;
    }

    setBusy(`${input.kind}:${input.action}:${input.id ?? 'all'}`);
    const toastId = toast.loading('Running Docker action...');
    const response = await stackarrFetch('/api/v1/containers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...input,
        confirmDangerous: destructive,
        reason: destructive ? label : undefined
      })
    });
    const body = await response.json().catch(() => ({}));
    setBusy('');

    if (!response.ok || body.accepted === false) {
      const errorMessage = body.message ?? 'Docker action failed.';
      setMessage(errorMessage);
      toast.error(errorMessage, { id: toastId });
      return;
    }

    setMessage('Docker action completed.');
    toast.success('Docker action completed.', { id: toastId });
    await refresh({ full: tab !== 'containers' });
  }

  const cleanup = cleanupFor(tab, data);
  const running = data.containers.filter((item) => item.running);
  const totals = containerMetricTotals(running);
  const stackGroups = groupContainers(containerItems);

  async function selectTab(nextTab: TabKey) {
    setTab(nextTab);
    setQuery('');
    if (nextTab !== 'containers' && !advancedLoaded) {
      await refresh({ full: true });
    }
  }

  return (
    <div className={styles.manager}>
      <header className={styles.runtimeHeader}>
        <div className={styles.runtimeTitle}>
          <span className={data.dockerAvailable ? styles.runtimeOnline : styles.runtimeOffline} aria-hidden="true" />
          <div>
            <strong>{data.dockerAvailable ? 'Docker is connected' : 'Docker is unavailable'}</strong>
            <small>
              {data.counts.runningContainers} running · {data.counts.stoppedContainers} stopped · updated{' '}
              {formatActivityTime(data.generatedAt)}
            </small>
          </div>
        </div>
        <div className={styles.runtimeMetrics} aria-label="Container activity summary">
          <MetricCard
            history={metricHistory.map((point) => point.cpu)}
            label="CPU"
            value={`${formatMetric(totals.cpu)}%`}
          />
          <MetricCard
            history={metricHistory.map((point) => point.memory)}
            label="Memory"
            value={formatBytes(totals.memory) ?? '0 B'}
          />
          <MetricCard
            history={metricHistory.map((point) => point.network)}
            label="Network"
            value={formatPair(totals.network)}
          />
        </div>
        <button
          aria-label="Refresh infrastructure"
          className={styles.refreshButton}
          disabled={busy === 'refresh'}
          onClick={() => void refresh({ full: tab !== 'containers' })}
          type="button"
        >
          <icons.refresh aria-hidden="true" size={16} />
          <span>{busy === 'refresh' ? 'Refreshing' : 'Refresh'}</span>
        </button>
      </header>

      <div className={styles.viewbar}>
        <div className={styles.tabbar} role="tablist" aria-label="Infrastructure views">
          {tabs.map((item) => (
            <button
              key={item.key}
              aria-selected={tab === item.key}
              className={tab === item.key ? styles.tabActive : styles.tab}
              onClick={() => void selectTab(item.key)}
              role="tab"
              type="button"
            >
              <item.icon aria-hidden="true" size={14} />
              <span>{item.label}</span>
              <small>{tabCount(item.key, data)}</small>
            </button>
          ))}
        </div>
        <label className={styles.search}>
          <icons.search aria-hidden="true" size={14} />
          <span className={styles.visuallyHidden}>Search {tabs.find((item) => item.key === tab)?.label}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find an app or resource"
          />
        </label>
        {cleanup && (
          <button
            className={styles.cleanupButton}
            disabled={Boolean(busy)}
            onClick={() => void runAction(cleanup.input, cleanup.confirm)}
            type="button"
          >
            {cleanup.label}
          </button>
        )}
      </div>

      {message && <p className={data.dockerAvailable ? styles.note : styles.error}>{message}</p>}

      {tab === 'containers' && (
        <div className={styles.stackWorkspace}>
          <section className={styles.stacks} aria-label="Compose stacks and apps">
            {stackGroups.length === 0 ? (
              <div className={styles.empty}>No apps match this view.</div>
            ) : (
              stackGroups.map((group) => (
                <StackGroup
                  key={group.key}
                  group={group}
                  busy={busy}
                  selectedId={activeContainer ? containerKey(activeContainer) : ''}
                  onAction={runAction}
                  onSelect={(key) => setSelectedKey('containers', key, setSelected)}
                />
              ))
            )}
          </section>
          <aside className={styles.detail} aria-label="Selected app details">
            {activeContainer ? (
              <ContainerDetails item={activeContainer} onAction={runAction} />
            ) : (
              <StackSummary groups={stackGroups} counts={data.counts} />
            )}
          </aside>
        </div>
      )}

      {tab !== 'containers' && (
        <div className={styles.resourceWorkspace} aria-busy={!advancedLoaded && busy === 'refresh'}>
          <section className={styles.resourceList} aria-label="Advanced Docker resources">
            {!advancedLoaded && <div className={styles.empty}>Loading advanced Docker resources…</div>}
            {tab === 'volumes' && (
              <ResourceList
                items={volumeItems}
                active={activeVolume}
                itemKey={volumeKey}
                onSelect={(key) => setSelectedKey('volumes', key, setSelected)}
              >
                {(item) => <VolumeRow item={item} busy={busy} onAction={runAction} />}
              </ResourceList>
            )}
            {tab === 'images' && (
              <ImageSections
                items={imageItems}
                active={activeImage}
                onSelect={(key) => setSelectedKey('images', key, setSelected)}
                busy={busy}
                onAction={runAction}
              />
            )}
            {tab === 'networks' && (
              <ResourceList
                items={networkItems}
                active={activeNetwork}
                itemKey={networkKey}
                onSelect={(key) => setSelectedKey('networks', key, setSelected)}
              >
                {(item) => <NetworkRow item={item} busy={busy} onAction={runAction} />}
              </ResourceList>
            )}
          </section>
          <section className={styles.detail} aria-label="Resource details">
            {tab === 'volumes' && <VolumeDetails item={activeVolume} onAction={runAction} />}
            {tab === 'images' && <ImageDetails item={activeImage} onAction={runAction} />}
            {tab === 'networks' && <NetworkDetails item={activeNetwork} onAction={runAction} />}
          </section>
        </div>
      )}
    </div>
  );
}

type ContainerGroup = { key: string; label: string; description: string; items: DockerContainerItem[] };

function StackGroup({
  group,
  busy,
  selectedId,
  onAction,
  onSelect
}: {
  group: ContainerGroup;
  busy: string;
  selectedId: string;
  onAction: (input: ActionInput, label: string) => Promise<void>;
  onSelect: (key: string) => void;
}) {
  const running = group.items.filter((item) => item.running).length;
  return (
    <section className={styles.stackGroup}>
      <header className={styles.stackHeader}>
        <div>
          <span className={running === group.items.length ? styles.stackGood : styles.stackMixed} aria-hidden="true" />
          <div>
            <h2>{group.label}</h2>
            <p>{group.description}</p>
          </div>
        </div>
        <Badge tone={running === group.items.length ? 'good' : running > 0 ? 'warn' : 'neutral'}>
          {running}/{group.items.length} running
        </Badge>
      </header>
      <div className={styles.appGrid}>
        {group.items.map((item) => {
          const key = containerKey(item);
          return (
            <article
              key={key}
              className={key === selectedId ? styles.appCardActive : styles.appCard}
              onClick={() => onSelect(key)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(key);
                }
              }}
              tabIndex={0}
            >
              <ContainerRow item={item} busy={busy} onAction={onAction} />
              <div className={styles.appMetrics}>
                <span>
                  CPU <strong>{item.stats?.cpu || '—'}</strong>
                </span>
                <span>
                  Memory <strong>{shortMetric(item.stats?.memory)}</strong>
                </span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StackSummary({ groups, counts }: { groups: ContainerGroup[]; counts: DockerOverview['counts'] }) {
  return (
    <div className={styles.stackSummary}>
      <span className={styles.summaryIcon}>
        <icons.stack aria-hidden="true" size={26} />
      </span>
      <div>
        <h2>Your infrastructure</h2>
        <p>Select an app to inspect its ports, mounts, networks, and lifecycle controls.</p>
      </div>
      <dl>
        <div>
          <dt>Stacks</dt>
          <dd>{groups.length}</dd>
        </div>
        <div>
          <dt>Apps</dt>
          <dd>{counts.containers}</dd>
        </div>
        <div>
          <dt>Running</dt>
          <dd>{counts.runningContainers}</dd>
        </div>
        <div>
          <dt>Stopped</dt>
          <dd>{counts.stoppedContainers}</dd>
        </div>
      </dl>
      <p className={styles.advancedHint}>Volumes, images, and networks load only when you open their tabs.</p>
    </div>
  );
}

function ResourceList<T>({
  items,
  active,
  itemKey,
  onSelect,
  children
}: {
  items: T[];
  active?: T;
  itemKey: (item: T) => string;
  onSelect: (key: string) => void;
  children: (item: T) => React.ReactNode;
}) {
  const activeKey = active ? itemKey(active) : '';

  if (items.length === 0) {
    return <div className={styles.empty}>No resources match this view.</div>;
  }

  return (
    <div className={styles.list}>
      {items.map((item) => {
        const key = itemKey(item);

        return (
          <div
            key={key}
            className={key === activeKey ? styles.rowActive : styles.row}
            onClick={() => onSelect(key)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(key);
              }
            }}
            role="button"
            tabIndex={0}
          >
            {children(item)}
          </div>
        );
      })}
    </div>
  );
}

function MetricCard({ history, label, value }: { history: number[]; label: string; value: string }) {
  return (
    <div className={styles.metricCard}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <Sparkline label={`${label} over the last ${history.length} samples`} values={history} />
    </div>
  );
}

function Sparkline({ label, values }: { label: string; values: number[] }) {
  const width = 92;
  const height = 28;
  const finite = values.map((value) => (Number.isFinite(value) ? value : 0));
  const minimum = Math.min(...finite, 0);
  const maximum = Math.max(...finite, 1);
  const range = Math.max(1, maximum - minimum);
  const points = finite
    .map((value, index) => {
      const x = finite.length <= 1 ? width : (index / (finite.length - 1)) * width;
      const y = height - ((value - minimum) / range) * (height - 3) - 1.5;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg aria-label={label} className={styles.sparkline} role="img" viewBox={`0 0 ${width} ${height}`}>
      <polyline fill="none" points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function ImageSections({
  items,
  active,
  busy,
  onAction,
  onSelect
}: {
  items: DockerImageItem[];
  active?: DockerImageItem;
  busy: string;
  onAction: (input: ActionInput, label: string) => Promise<void>;
  onSelect: (key: string) => void;
}) {
  const activeKey = active ? imageKey(active) : '';
  const sections = [
    { title: 'In Use', items: items.filter((item) => item.inUse) },
    { title: 'Unused', items: items.filter((item) => !item.inUse && !item.dangling) },
    { title: 'Dangling', items: items.filter((item) => !item.inUse && item.dangling) }
  ].filter((section) => section.items.length > 0);

  if (items.length === 0) {
    return <div className={styles.empty}>No resources match this view.</div>;
  }

  return (
    <div className={styles.list}>
      {sections.map((section) => (
        <section key={section.title} className={styles.resourceSection}>
          <h3>{section.title}</h3>
          {section.items.map((item) => {
            const key = imageKey(item);

            return (
              <div
                key={key}
                className={key === activeKey ? styles.rowActive : styles.row}
                onClick={() => onSelect(key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(key);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <ImageRow item={item} busy={busy} onAction={onAction} />
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function ContainerRow({
  item,
  busy,
  onAction
}: {
  item: DockerContainerItem;
  busy: string;
  onAction: (input: ActionInput, label: string) => Promise<void>;
}) {
  const serviceName = item.composeService ?? item.displayName;

  return (
    <>
      <ServiceLogo name={serviceName} size={36} />
      <div className={styles.rowBody}>
        <strong>{item.displayName}</strong>
        <span>{item.image}</span>
        <small>
          {item.kind} · {item.status}
        </small>
      </div>
      <div className={styles.rowActions}>
        {item.localUrls[0] && (
          <a
            className={styles.iconButton}
            href={item.localUrls[0]}
            onClick={(event) => event.stopPropagation()}
            rel="noreferrer"
            target="_blank"
            title={`Open ${item.localUrls[0]}`}
          >
            <icons.link aria-hidden="true" size={13} />
          </a>
        )}
        {item.running ? (
          <IconAction
            busy={busy}
            input={{ kind: 'container', action: 'stop', id: item.id }}
            label={`Stop ${item.displayName}?`}
            onAction={onAction}
            title="Stop"
          >
            <icons.stop aria-hidden="true" size={12} />
          </IconAction>
        ) : (
          <IconAction
            busy={busy}
            input={{ kind: 'container', action: 'start', id: item.id }}
            label={`Start ${item.displayName}`}
            onAction={onAction}
            title="Start"
          >
            <icons.playSolid aria-hidden="true" size={12} />
          </IconAction>
        )}
        {item.running && (
          <IconAction
            busy={busy}
            input={{ kind: 'container', action: 'restart', id: item.id }}
            label={`Restart ${item.displayName}?`}
            onAction={onAction}
            title="Restart"
          >
            <icons.refresh aria-hidden="true" size={12} />
          </IconAction>
        )}
        {item.removable && (
          <IconAction
            danger
            busy={busy}
            input={{ kind: 'container', action: 'remove', id: item.id }}
            label={`Remove stopped container ${item.displayName}?`}
            onAction={onAction}
            title="Remove"
          >
            x
          </IconAction>
        )}
      </div>
    </>
  );
}

function VolumeRow({
  item,
  busy,
  onAction
}: {
  item: DockerVolumeItem;
  busy: string;
  onAction: (input: ActionInput, label: string) => Promise<void>;
}) {
  return (
    <>
      <icons.drive aria-hidden="true" className={styles.resourceIcon} size={26} />
      <div className={styles.rowBody}>
        <strong>{item.name}</strong>
        <span>{item.size ?? formatBytes(item.sizeBytes) ?? 'Size unknown'}</span>
        <small>{item.inUse ? `Used by ${item.usedBy.join(', ')}` : 'Unused volume'}</small>
      </div>
      <div className={styles.rowActions}>
        {item.removable && (
          <IconAction
            danger
            busy={busy}
            input={{ kind: 'volume', action: 'remove', id: item.name }}
            label={`Remove unused volume ${item.name}?`}
            onAction={onAction}
            title="Remove"
          >
            x
          </IconAction>
        )}
      </div>
    </>
  );
}

function ImageRow({
  item,
  busy,
  onAction
}: {
  item: DockerImageItem;
  busy: string;
  onAction: (input: ActionInput, label: string) => Promise<void>;
}) {
  return (
    <>
      <icons.image aria-hidden="true" className={styles.resourceIcon} size={26} />
      <div className={styles.rowBody}>
        <strong>{item.reference}</strong>
        <span>
          {item.size ?? 'Size unknown'}
          {item.createdSince ? `, ${item.createdSince}` : ''}
        </span>
        <small>
          {item.inUse ? `Used by ${item.usedBy.join(', ')}` : item.dangling ? 'Dangling image' : 'Unused image'}
        </small>
      </div>
      <div className={styles.rowActions}>
        {item.removable && (
          <IconAction
            danger
            busy={busy}
            input={{ kind: 'image', action: 'remove', id: item.id }}
            label={`Remove image ${item.reference}?`}
            onAction={onAction}
            title="Remove"
          >
            x
          </IconAction>
        )}
      </div>
    </>
  );
}

function NetworkRow({
  item,
  busy,
  onAction
}: {
  item: DockerNetworkItem;
  busy: string;
  onAction: (input: ActionInput, label: string) => Promise<void>;
}) {
  return (
    <>
      <icons.network aria-hidden="true" className={styles.resourceIcon} size={26} />
      <div className={styles.rowBody}>
        <strong>{item.name}</strong>
        <span>
          {item.driver ?? 'network'}
          {item.subnets.length > 0 ? `, ${item.subnets.join(', ')}` : ''}
        </span>
        <small>
          {item.system ? 'Docker system network' : item.inUse ? `Used by ${item.usedBy.join(', ')}` : 'Unused network'}
        </small>
      </div>
      <div className={styles.rowActions}>
        {item.removable && (
          <IconAction
            danger
            busy={busy}
            input={{ kind: 'network', action: 'remove', id: item.id }}
            label={`Remove unused network ${item.name}?`}
            onAction={onAction}
            title="Remove"
          >
            x
          </IconAction>
        )}
      </div>
    </>
  );
}

function IconAction({
  busy,
  children,
  danger,
  input,
  label,
  onAction,
  title
}: {
  busy: string;
  children: React.ReactNode;
  danger?: boolean;
  input: ActionInput;
  label: string;
  onAction: (input: ActionInput, label: string) => Promise<void>;
  title: string;
}) {
  return (
    <button
      className={danger ? styles.iconDanger : styles.iconButton}
      disabled={Boolean(busy)}
      onClick={(event) => {
        event.stopPropagation();
        void onAction(input, label);
      }}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function ContainerDetails({
  item,
  onAction
}: {
  item?: DockerContainerItem;
  onAction: (input: ActionInput, label: string) => Promise<void>;
}) {
  if (!item) return <NoSelection />;

  return (
    <div className={styles.detailInner}>
      <DetailHeader
        icon={<ServiceLogo name={item.composeService ?? item.displayName} size={42} />}
        title={item.displayName}
        subtitle={item.image}
        badges={[item.kind, item.running ? 'running' : item.state, item.stackarrManaged ? 'stackarr' : 'external']}
      />
      <div className={styles.detailActions}>
        {item.localUrls.map((url) => (
          <a key={url} className={styles.primaryLink} href={url} rel="noreferrer" target="_blank">
            Open {url}
          </a>
        ))}
        {item.running ? (
          <>
            <button
              onClick={() =>
                void onAction({ kind: 'container', action: 'restart', id: item.id }, `Restart ${item.displayName}?`)
              }
              type="button"
            >
              Restart
            </button>
            <button
              onClick={() =>
                void onAction({ kind: 'container', action: 'stop', id: item.id }, `Stop ${item.displayName}?`)
              }
              type="button"
            >
              Stop
            </button>
          </>
        ) : (
          <button
            onClick={() =>
              void onAction({ kind: 'container', action: 'start', id: item.id }, `Start ${item.displayName}`)
            }
            type="button"
          >
            Start
          </button>
        )}
        {item.removable && (
          <button
            className={styles.dangerButton}
            onClick={() =>
              void onAction(
                { kind: 'container', action: 'remove', id: item.id },
                `Remove stopped container ${item.displayName}?`
              )
            }
            type="button"
          >
            Remove
          </button>
        )}
      </div>

      <InfoGrid
        rows={[
          ['Status', item.status],
          ['Container ID', item.shortId],
          ['Docker name', item.name],
          ['Compose service', item.composeService ?? 'none'],
          ['Restart policy', item.restartPolicy ?? 'none'],
          ['CPU', item.stats?.cpu ?? 'not sampled'],
          ['Memory', item.stats?.memory ?? 'not sampled'],
          ['Network', item.stats?.network ?? 'not sampled'],
          ['Disk', item.stats?.disk ?? 'not sampled']
        ]}
      />
      <KeyList
        title="Ports"
        rows={item.ports.map((port) => [
          port.container,
          port.hostPort ? formatHostPort(port.hostIp, port.hostPort) : 'not published'
        ])}
      />
      <KeyList
        title="Mounts"
        rows={item.mounts.map((mount) => [mount.destination ?? 'mount', mount.name ?? mount.source ?? mount.type])}
      />
      <KeyList title="Labels" rows={Object.entries(item.labels)} />
    </div>
  );
}

function VolumeDetails({
  item,
  onAction
}: {
  item?: DockerVolumeItem;
  onAction: (input: ActionInput, label: string) => Promise<void>;
}) {
  if (!item) return <NoSelection />;

  return (
    <div className={styles.detailInner}>
      <DetailHeader
        icon={<icons.drive aria-hidden="true" size={34} />}
        title={item.name}
        subtitle={item.mountpoint ?? 'Docker volume'}
        badges={[item.inUse ? 'in use' : 'unused']}
      />
      <div className={styles.detailActions}>
        {item.removable && (
          <button
            className={styles.dangerButton}
            onClick={() =>
              void onAction({ kind: 'volume', action: 'remove', id: item.name }, `Remove unused volume ${item.name}?`)
            }
            type="button"
          >
            Remove
          </button>
        )}
      </div>
      <InfoGrid
        rows={[
          ['Driver', item.driver ?? 'unknown'],
          ['Scope', item.scope ?? 'unknown'],
          ['Size', item.size ?? formatBytes(item.sizeBytes) ?? 'unknown'],
          ['Created', item.createdAt ?? 'unknown'],
          ['Used by', item.usedBy.join(', ') || 'none']
        ]}
      />
      <KeyList title="Labels" rows={Object.entries(item.labels)} />
    </div>
  );
}

function ImageDetails({
  item,
  onAction
}: {
  item?: DockerImageItem;
  onAction: (input: ActionInput, label: string) => Promise<void>;
}) {
  if (!item) return <NoSelection />;

  return (
    <div className={styles.detailInner}>
      <DetailHeader
        icon={<icons.image aria-hidden="true" size={34} />}
        title={item.reference}
        subtitle={item.id}
        badges={[item.inUse ? 'in use' : 'unused', item.dangling ? 'dangling' : item.tag]}
      />
      <div className={styles.detailActions}>
        {item.removable && (
          <button
            className={styles.dangerButton}
            onClick={() =>
              void onAction({ kind: 'image', action: 'remove', id: item.id }, `Remove image ${item.reference}?`)
            }
            type="button"
          >
            Remove
          </button>
        )}
      </div>
      <InfoGrid
        rows={[
          ['Repository', item.repository],
          ['Tag', item.tag],
          ['Digest', item.digest ?? 'none'],
          ['Size', item.size ?? 'unknown'],
          ['Created', item.createdSince ?? 'unknown'],
          ['Used by', item.usedBy.join(', ') || 'none']
        ]}
      />
    </div>
  );
}

function NetworkDetails({
  item,
  onAction
}: {
  item?: DockerNetworkItem;
  onAction: (input: ActionInput, label: string) => Promise<void>;
}) {
  if (!item) return <NoSelection />;

  return (
    <div className={styles.detailInner}>
      <DetailHeader
        icon={<icons.network aria-hidden="true" size={34} />}
        title={item.name}
        subtitle={item.id}
        badges={[item.system ? 'system' : item.inUse ? 'in use' : 'unused']}
      />
      <div className={styles.detailActions}>
        {item.removable && (
          <button
            className={styles.dangerButton}
            onClick={() =>
              void onAction({ kind: 'network', action: 'remove', id: item.id }, `Remove unused network ${item.name}?`)
            }
            type="button"
          >
            Remove
          </button>
        )}
      </div>
      <InfoGrid
        rows={[
          ['Driver', item.driver ?? 'unknown'],
          ['Scope', item.scope ?? 'unknown'],
          ['Internal', item.internal ? 'yes' : 'no'],
          ['Attachable', item.attachable ? 'yes' : 'no'],
          ['Subnets', item.subnets.join(', ') || 'none'],
          ['Used by', item.usedBy.join(', ') || 'none']
        ]}
      />
      <KeyList title="Labels" rows={Object.entries(item.labels)} />
    </div>
  );
}

function DetailHeader({
  icon,
  title,
  subtitle,
  badges
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badges: string[];
}) {
  return (
    <header className={styles.detailHeader}>
      <div className={styles.detailIcon}>{icon}</div>
      <div>
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className={styles.badges}>
        {badges.map((badge) => (
          <Badge
            key={badge}
            tone={
              badge === 'running' || badge === 'in use' || badge === 'stackarr'
                ? 'good'
                : badge === 'unused' || badge === 'dangling'
                  ? 'warn'
                  : 'neutral'
            }
          >
            {badge}
          </Badge>
        ))}
      </div>
    </header>
  );
}

function InfoGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className={styles.infoGrid}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function KeyList({ title, rows }: { title: string; rows: Array<[string, string | undefined]> }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <section className={styles.keyList}>
      <h3>{title}</h3>
      {rows.map(([key, value]) => (
        <div key={`${key}:${value}`}>
          <span>{key}</span>
          <strong>{value || 'none'}</strong>
        </div>
      ))}
    </section>
  );
}

function NoSelection() {
  return (
    <div className={styles.noSelection}>
      <icons.containers aria-hidden="true" size={36} />
      <strong>No Selection</strong>
    </div>
  );
}

function normalizeOverview(overview: DockerOverview | DockerContainerOverview): DockerOverview {
  if ('volumes' in overview) {
    return overview;
  }

  return {
    ...overview,
    counts: {
      ...overview.counts,
      volumes: 0,
      unusedVolumes: 0,
      images: 0,
      unusedImages: 0,
      danglingImages: 0,
      networks: 0,
      unusedNetworks: 0
    },
    volumes: [],
    images: [],
    networks: []
  };
}

function mergeContainerOverview(
  current: DockerOverview,
  overview: DockerOverview | DockerContainerOverview
): DockerOverview {
  return {
    ...current,
    dockerAvailable: overview.dockerAvailable,
    error: overview.error,
    generatedAt: overview.generatedAt,
    containers: overview.containers,
    counts: { ...current.counts, ...overview.counts }
  };
}

function groupContainers(items: DockerContainerItem[]): ContainerGroup[] {
  const groups = new Map<string, DockerContainerItem[]>();
  for (const item of items) {
    const key = item.composeProject || (item.stackarrManaged ? 'stackarr' : 'standalone');
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, containers]) => ({
      key,
      label: key === 'stackarr' ? 'Stackarr' : key === 'standalone' ? 'Standalone' : humanizeProject(key),
      description:
        key === 'stackarr'
          ? 'Your managed homelab apps'
          : key === 'standalone'
            ? 'Containers outside a Compose stack'
            : `Compose project · ${key}`,
      items: containers
    }))
    .sort((a, b) => groupRank(a.key) - groupRank(b.key) || a.label.localeCompare(b.label));
}

function groupRank(key: string) {
  if (key === 'stackarr') return 0;
  if (key === 'standalone') return 2;
  return 1;
}

function humanizeProject(value: string) {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function containerMetricTotals(items: DockerContainerItem[]) {
  return items.reduce(
    (summary, item) => {
      const network = item.stats
        ? {
            first: item.stats.networkRxBytes ?? parseMetricPair(item.stats.network).first,
            second: item.stats.networkTxBytes ?? parseMetricPair(item.stats.network).second
          }
        : { first: 0, second: 0 };
      return {
        cpu: summary.cpu + (item.stats?.cpuPercent ?? parsePercent(item.stats?.cpu)),
        memory: summary.memory + (item.stats?.memoryBytes ?? parseMemoryUsage(item.stats?.memory)),
        network: { first: summary.network.first + network.first, second: summary.network.second + network.second }
      };
    },
    { cpu: 0, memory: 0, network: { first: 0, second: 0 } }
  );
}

function metricHistoryPoint(data: DockerOverview): MetricHistoryPoint {
  const totals = containerMetricTotals(data.containers.filter((item) => item.running));
  return {
    at: new Date(data.generatedAt).getTime() || Date.now(),
    cpu: totals.cpu,
    memory: totals.memory,
    network: totals.network.first + totals.network.second
  };
}

function cleanupFor(tab: TabKey, data: DockerOverview): { label: string; confirm: string; input: ActionInput } | null {
  if (tab === 'containers' && data.counts.stoppedContainers > 0) {
    return {
      label: 'Remove Exited',
      confirm: 'Remove all stopped containers?',
      input: { kind: 'container', action: 'pruneExited' }
    };
  }
  if (tab === 'volumes' && data.counts.unusedVolumes > 0) {
    return {
      label: 'Remove Unused',
      confirm: 'Remove all unused Docker volumes?',
      input: { kind: 'volume', action: 'pruneUnused' }
    };
  }
  if (tab === 'images' && data.counts.danglingImages > 0) {
    return {
      label: 'Remove Dangling',
      confirm: 'Remove all dangling Docker images?',
      input: { kind: 'image', action: 'pruneDangling' }
    };
  }
  if (tab === 'images' && data.counts.unusedImages > 0) {
    return {
      label: 'Remove Unused',
      confirm: 'Remove all unused Docker images?',
      input: { kind: 'image', action: 'pruneUnused' }
    };
  }
  if (tab === 'networks' && data.counts.unusedNetworks > 0) {
    return {
      label: 'Remove Unused',
      confirm: 'Remove all unused Docker networks?',
      input: { kind: 'network', action: 'pruneUnused' }
    };
  }

  return null;
}

function tabCount(tab: TabKey, data: DockerOverview) {
  if (tab === 'containers') return data.counts.containers;
  if (tab === 'volumes') return data.counts.volumes;
  if (tab === 'images') return data.counts.images;
  return data.counts.networks;
}

function setSelectedKey(tab: TabKey, key: string, setSelected: React.Dispatch<React.SetStateAction<SelectedKeys>>) {
  setSelected((current) => ({ ...current, [tab]: key }));
}

function selectedItem<T>(items: T[], selectedKey: string | undefined, keyFor: (item: T) => string) {
  return items.find((item) => keyFor(item) === selectedKey) ?? items[0];
}

function filterItems<T>(items: T[], query: string, searchableText: (item: T) => string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => searchableText(item).toLowerCase().includes(needle));
}

function containerSearchText(item: DockerContainerItem) {
  return [item.displayName, item.name, item.image, item.status, item.composeProject, item.composeService].join(' ');
}

function volumeSearchText(item: DockerVolumeItem) {
  return [item.name, item.driver, item.scope, ...item.usedBy].join(' ');
}

function imageSearchText(item: DockerImageItem) {
  return [item.reference, item.repository, item.tag, item.digest, ...item.usedBy].join(' ');
}

function networkSearchText(item: DockerNetworkItem) {
  return [item.name, item.driver, item.scope, ...item.subnets, ...item.usedBy].join(' ');
}

function isDestructive(input: ActionInput) {
  return (
    input.action === 'remove' ||
    input.action === 'pruneExited' ||
    input.action === 'pruneDangling' ||
    input.action === 'pruneUnused' ||
    input.action === 'stop' ||
    input.action === 'restart'
  );
}

function containerKey(item: DockerContainerItem) {
  return item.id || item.name;
}

function volumeKey(item: DockerVolumeItem) {
  return item.name;
}

function imageKey(item: DockerImageItem) {
  return `${item.id || item.shortId}:${item.reference}:${item.digest ?? ''}`;
}

function networkKey(item: DockerNetworkItem) {
  return item.id || item.name;
}

function formatBytes(value?: number) {
  if (value === undefined || value < 0) {
    return undefined;
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }

  return `${size.toFixed(size >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatMetric(value: number) {
  return value.toFixed(value >= 10 ? 0 : 1);
}

function formatPair(pair: MetricPair) {
  return `${formatBytes(pair.first) ?? '0 B'} / ${formatBytes(pair.second) ?? '0 B'}`;
}

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'now';
  }

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function shortMetric(value?: string) {
  return value?.split('/')[0]?.trim() || '-';
}

function parsePercent(value?: string) {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseFloat(value.replace('%', '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMemoryUsage(value?: string) {
  return parseDockerSize(value?.split('/')[0]);
}

function parseMetricPair(value?: string): MetricPair {
  const [first, second] = value?.split('/') ?? [];
  return {
    first: parseDockerSize(first),
    second: parseDockerSize(second)
  };
}

function parseDockerSize(value?: string) {
  const match = value?.trim().match(/^([\d.,]+)\s*([kmgtp]?i?b|b)$/i);
  if (!match) {
    return 0;
  }

  const amount = Number.parseFloat(match[1].replace(',', '.'));
  if (!Number.isFinite(amount)) {
    return 0;
  }

  const unit = match[2].toLowerCase();
  const power = unit.startsWith('p')
    ? 5
    : unit.startsWith('t')
      ? 4
      : unit.startsWith('g')
        ? 3
        : unit.startsWith('m')
          ? 2
          : unit.startsWith('k')
            ? 1
            : 0;
  const base = unit.includes('i') ? 1024 : 1000;
  return amount * base ** power;
}

function formatHostPort(hostIp: string | undefined, hostPort: string) {
  const host = hostIp && hostIp.includes(':') ? `[${hostIp}]` : hostIp || '127.0.0.1';
  return `${host}:${hostPort}`;
}

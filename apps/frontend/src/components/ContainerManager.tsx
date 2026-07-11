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

const tabs: Array<{ key: TabKey; label: string; icon: typeof icons.container }> = [
  { key: 'containers', label: 'Containers', icon: icons.container },
  { key: 'volumes', label: 'Volumes', icon: icons.drive },
  { key: 'images', label: 'Images', icon: icons.image },
  { key: 'networks', label: 'Network', icon: icons.network }
];

export function ContainerManager({ overview }: { overview: DockerOverview }) {
  const [data, setData] = useState(overview);
  const [tab, setTab] = useState<TabKey>('containers');
  const [selected, setSelected] = useState<SelectedKeys>({});
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(data.error ?? '');

  const containerItems = useMemo(() => filterItems(data.containers, query), [data.containers, query]);
  const volumeItems = useMemo(() => filterItems(data.volumes, query), [data.volumes, query]);
  const imageItems = useMemo(() => filterItems(data.images, query), [data.images, query]);
  const networkItems = useMemo(() => filterItems(data.networks, query), [data.networks, query]);

  const activeContainer = selectedItem(containerItems, selected.containers, containerKey);
  const activeVolume = selectedItem(volumeItems, selected.volumes, volumeKey);
  const activeImage = selectedItem(imageItems, selected.images, imageKey);
  const activeNetwork = selectedItem(networkItems, selected.networks, networkKey);

  const refresh = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setBusy('refresh');
    }

    const response = await stackarrFetch(options.silent ? '/api/v1/containers?scope=containers' : '/api/v1/containers');
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

    setData((current) =>
      options.silent
        ? {
            ...current,
            dockerAvailable: body.dockerAvailable,
            error: body.error,
            generatedAt: body.generatedAt,
            containers: body.containers,
            counts: { ...current.counts, ...body.counts }
          }
        : (body as DockerOverview)
    );
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
    }, 15000);

    return () => window.clearInterval(interval);
  }, [data.dockerAvailable, refresh, tab]);

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
    await refresh();
  }

  const cleanup = cleanupFor(tab, data);

  return (
    <div className={styles.manager}>
      <section className={styles.sidebar} aria-label="Docker resources">
        <div className={styles.tabbar} role="tablist" aria-label="Container resource tabs">
          {tabs.map((item) => (
            <button
              key={item.key}
              aria-selected={tab === item.key}
              className={tab === item.key ? styles.tabActive : styles.tab}
              onClick={() => setTab(item.key)}
              role="tab"
              type="button"
            >
              <item.icon aria-hidden="true" size={14} />
              <span>{item.label}</span>
              <small>{tabCount(item.key, data)}</small>
            </button>
          ))}
        </div>

        <div className={styles.toolbar}>
          <label className={styles.search}>
            <span>Search</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter resources" />
          </label>
          <button
            className={styles.iconButton}
            disabled={busy === 'refresh'}
            onClick={() => void refresh()}
            type="button"
            title="Refresh"
          >
            <icons.refresh aria-hidden="true" size={14} />
          </button>
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
          <>
            <ContainerActivity items={containerItems} generatedAt={data.generatedAt} />
            <ResourceList
              items={containerItems}
              active={activeContainer}
              itemKey={containerKey}
              onSelect={(key) => setSelectedKey('containers', key, setSelected)}
            >
              {(item) => <ContainerRow item={item} busy={busy} onAction={runAction} />}
            </ResourceList>
          </>
        )}
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
        {tab === 'containers' && <ContainerDetails item={activeContainer} onAction={runAction} />}
        {tab === 'volumes' && <VolumeDetails item={activeVolume} onAction={runAction} />}
        {tab === 'images' && <ImageDetails item={activeImage} onAction={runAction} />}
        {tab === 'networks' && <NetworkDetails item={activeNetwork} onAction={runAction} />}
      </section>
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

function ContainerActivity({ items, generatedAt }: { items: DockerContainerItem[]; generatedAt: string }) {
  const running = items.filter((item) => item.running);
  const totals = running.reduce(
    (summary, item) => {
      const network = parseMetricPair(item.stats?.network);
      const disk = parseMetricPair(item.stats?.disk);

      return {
        cpu: summary.cpu + parsePercent(item.stats?.cpu),
        memory: summary.memory + parseMemoryUsage(item.stats?.memory),
        network: { first: summary.network.first + network.first, second: summary.network.second + network.second },
        disk: { first: summary.disk.first + disk.first, second: summary.disk.second + disk.second }
      };
    },
    { cpu: 0, memory: 0, network: { first: 0, second: 0 }, disk: { first: 0, second: 0 } }
  );

  return (
    <section className={styles.activityPanel} aria-label="Live container activity">
      <header className={styles.activityHeader}>
        <div>
          <strong>Live Activity</strong>
          <span>
            {running.length} running · updated {formatActivityTime(generatedAt)}
          </span>
        </div>
        <span className={styles.liveDot}>Live</span>
      </header>
      <div className={styles.activitySummary}>
        <MetricCard label="CPU" value={`${formatMetric(totals.cpu)}%`} />
        <MetricCard label="Memory" value={formatBytes(totals.memory) ?? '0 B'} />
        <MetricCard label="Network" value={formatPair(totals.network)} />
        <MetricCard label="Disk" value={formatPair(totals.disk)} />
      </div>
      <div className={styles.activityTable} role="table" aria-label="Container resource usage">
        <div className={styles.activityTableHead} role="row">
          <span>Name</span>
          <span>CPU</span>
          <span>Memory</span>
          <span>Network</span>
          <span>Disk</span>
        </div>
        {running.length === 0 ? (
          <div className={styles.activityEmpty}>No running containers.</div>
        ) : (
          running.map((item) => (
            <div key={item.id} className={styles.activityTableRow} role="row">
              <span>{item.displayName}</span>
              <span>{item.stats?.cpu ?? '-'}</span>
              <span>{shortMetric(item.stats?.memory)}</span>
              <span>{item.stats?.network ?? '-'}</span>
              <span>{item.stats?.disk ?? '-'}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metricCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
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

function filterItems<T>(items: T[], query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => JSON.stringify(item).toLowerCase().includes(needle));
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

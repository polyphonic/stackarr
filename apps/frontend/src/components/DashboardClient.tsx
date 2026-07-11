'use client';

import type { getSystemStatus, HomelabPerformance, ServiceSummary, StackarrTask, StackMetrics } from '@stackarr/core';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import styles from './DashboardClient.module.css';
import { DashboardOverview, StorageOverview } from './DashboardOverview';
import { icons } from './icons';
import { PerformanceOverview } from './PerformanceOverview';
import { ServiceLogo } from './ServiceLogo';
import { TaskProgressView, useLiveTasks } from './TaskProgress';
import { Badge, Panel, SearchInput } from './ui';

type SystemStatus = ReturnType<typeof getSystemStatus>;

export function DashboardClient({
  status,
  services,
  metrics,
  performance,
  tasks,
  favoriteNames
}: {
  status: SystemStatus;
  services: ServiceSummary[];
  metrics: StackMetrics;
  performance: HomelabPerformance;
  tasks: StackarrTask[];
  favoriteNames: string[];
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const liveTasks = useLiveTasks(tasks, { limit: 8 });
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const visibleServices = services.filter(
    (service) => service.name !== 'stackarr' && service.mode !== 'disabled' && service.experience === 'app'
  );
  const favoriteRank = new Map(favoriteNames.map((name, index) => [name, index]));
  const needsAttention = useMemo(
    () => buildAttentionItems(status.configured, services, metrics, liveTasks),
    [liveTasks, metrics, services, status.configured]
  );
  const activeTasks = liveTasks.filter((task) => task.status === 'queued' || task.status === 'running');
  const recentTasks = liveTasks.filter((task) => task.status !== 'queued' && task.status !== 'running').slice(0, 4);
  const featuredServices = visibleServices
    .filter((service) => service.browserUrl || service.localUrl)
    .sort((a, b) => (favoriteRank.get(a.name) ?? 999) - (favoriteRank.get(b.name) ?? 999))
    .slice(0, 10);
  const hasDownloads = visibleServices.some((service) => service.category === 'download');
  const emptyHomelab = status.configured && visibleServices.length === 0;
  const filteredServices = visibleServices.filter(
    (service) =>
      !normalizedSearch ||
      service.displayName.toLowerCase().includes(normalizedSearch) ||
      service.category.toLowerCase().includes(normalizedSearch) ||
      service.status.toLowerCase().includes(normalizedSearch)
  );

  return (
    <div className={styles.dashboard}>
      <section className={styles.hero} aria-labelledby="stack-summary-title">
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>{emptyHomelab ? 'Start with what you need' : 'Today in your homelab'}</span>
          <h2 id="stack-summary-title">{heroTitle(status.configured, metrics, visibleServices.length)}</h2>
          <p>{heroSummary(status.configured, metrics, visibleServices.length)}</p>
          <div className={styles.heroActions}>
            <Link className={styles.primaryLink} href="/stack/services#add-app">
              {emptyHomelab ? 'Add your first app' : 'Manage apps'}
            </Link>
            <Link className={styles.secondaryLink} href="/activity/queue">
              Follow activity
            </Link>
          </div>
        </div>
        <div className={styles.heroPulse} aria-label="Stack summary">
          <span className={metrics.serviceCounts.dockerRunning === null ? styles.pulseWarn : styles.pulseGood}></span>
          <strong>{metrics.serviceCounts.dockerRunning ?? '—'}</strong>
          <small>
            {metrics.serviceCounts.dockerRunning === null ? 'Docker status unavailable' : 'containers running'}
          </small>
        </div>
      </section>

      <section className={styles.quickLinks} aria-label="Quick destinations">
        <QuickLink href="/activity/queue" icon="activity" label="Active work" value={String(activeTasks.length)} />
        <QuickLink href="/containers" icon="containers" label="Infrastructure" value="Explore" />
        {hasDownloads && <QuickLink href="/downloaders" icon="download" label="Downloads" value="Manage" />}
        <QuickLink href="/agent" icon="manage" label="Automation" value="Open" />
      </section>

      <PerformanceOverview initial={performance} />

      <div className={styles.storageSection}>
        <StorageOverview metrics={metrics} />
      </div>

      <div className={styles.contentGrid}>
        <Panel
          title="Needs attention"
          description="Only items that may need a decision or follow-up"
          action={<Link href="/system/status">System details</Link>}
        >
          {needsAttention.length === 0 ? (
            <div className={styles.allClear}>
              <span aria-hidden="true">✓</span>
              <div>
                <strong>Nothing needs you right now</strong>
                <small>Stackarr will surface setup gaps and failed work here.</small>
              </div>
            </div>
          ) : (
            <div className={styles.attentionList}>
              {needsAttention.map((item) => (
                <Link href={item.href} key={item.label} className={styles.attentionItem}>
                  <span
                    className={item.tone === 'bad' ? styles.attentionBad : styles.attentionWarn}
                    aria-hidden="true"
                  />
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <span className={styles.attentionAction}>{item.action} ›</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title="Active work"
          description="Commands and automations currently moving through the stack"
          action={<Link href="/activity/queue">View activity</Link>}
        >
          {activeTasks.length === 0 ? (
            <div className={styles.quietState}>
              <strong>The queue is quiet</strong>
              <small>New chat and dashboard actions will appear here.</small>
            </div>
          ) : (
            <div className={styles.taskList}>
              {activeTasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </div>
          )}
          {recentTasks.length > 0 && (
            <div className={styles.recentTrail}>
              <span>Recent trail</span>
              {recentTasks.map((task) => (
                <TaskRow compact key={task.id} task={task} />
              ))}
              <Link href="/activity/history">See the complete action history</Link>
            </div>
          )}
        </Panel>
      </div>

      <section className={styles.appsSection} aria-labelledby="your-apps-title">
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Your homelab</span>
            <h2 id="your-apps-title">
              {visibleServices.length === 0 ? 'No apps yet' : visibleServices.length === 1 ? 'Your app' : 'Your apps'}
            </h2>
          </div>
          {visibleServices.length > 0 && <Link href="/stack/services">Manage apps</Link>}
        </div>
        {visibleServices.length === 0 ? (
          <div className={styles.emptyApps}>
            <ServiceLogo name="stackarr" size={48} />
            <div>
              <strong>Add only the apps you want</strong>
              <p>Start with Immich, RomM, Plex, Jellyfin, or a single utility. Stackarr adapts around your choices.</p>
            </div>
            <Link className={styles.primaryLink} href="/stack/services#add-app">
              Add app
            </Link>
          </div>
        ) : (
          <div className={`${styles.appShelf} ${visibleServices.length === 1 ? styles.singleAppShelf : ''}`}>
            {featuredServices.map((service) => (
              <AppTile key={service.name} service={service} />
            ))}
          </div>
        )}
      </section>

      <details className={styles.details}>
        <summary>Show system performance and every configured app</summary>
        <div className={styles.detailsBody}>
          <DashboardOverview metrics={metrics} />
          <Panel
            title="All configured apps"
            description="Search the full catalog without crowding your everyday view"
            action={<SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Find an app" />}
          >
            <div className={styles.appDirectory}>
              {filteredServices.length === 0 && <p>No apps match your search.</p>}
              {filteredServices.map((service) => (
                <AppTile key={service.name} service={service} compact />
              ))}
            </div>
          </Panel>
        </div>
      </details>
    </div>
  );
}

function QuickLink({
  href,
  icon,
  label,
  value
}: {
  href: string;
  icon: 'activity' | 'containers' | 'download' | 'manage';
  label: string;
  value: string;
}) {
  const Icon = {
    activity: icons.activity,
    containers: icons.containers,
    download: icons.download,
    manage: icons.manage
  }[icon];
  return (
    <Link className={styles.quickLink} href={href}>
      <span>
        <Icon aria-hidden="true" size={18} />
      </span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
      <b aria-hidden="true">›</b>
    </Link>
  );
}

function AppTile({ service, compact = false }: { service: ServiceSummary; compact?: boolean }) {
  const href = service.browserUrl ?? service.localUrl;
  const content = (
    <>
      <ServiceLogo name={service.name} size={compact ? 30 : 38} />
      <div>
        <strong>{service.displayName}</strong>
        <small>{service.category}</small>
      </div>
      <Badge tone={service.status === 'configured' ? 'good' : 'warn'}>{service.status}</Badge>
    </>
  );
  return href ? (
    <a
      className={compact ? styles.appTileCompact : styles.appTile}
      href={href}
      rel="noreferrer"
      target="_blank"
      aria-label={`Open ${service.displayName}`}
    >
      {content}
    </a>
  ) : (
    <div className={compact ? styles.appTileCompact : styles.appTile}>{content}</div>
  );
}

function TaskRow({ task, compact = false }: { task: StackarrTask; compact?: boolean }) {
  return (
    <div className={compact ? styles.taskRowCompact : styles.taskRow}>
      <div>
        <strong>{task.commandLabel}</strong>
        <small>{formatTime(task.queuedAt)}</small>
      </div>
      <Badge
        tone={
          task.status === 'failed'
            ? 'bad'
            : task.status === 'blocked'
              ? 'warn'
              : task.status === 'completed'
                ? 'good'
                : 'purple'
        }
      >
        {task.status}
      </Badge>
      {!compact && <TaskProgressView task={task} />}
    </div>
  );
}

function buildAttentionItems(
  configured: boolean,
  services: ServiceSummary[],
  metrics: StackMetrics,
  tasks: StackarrTask[]
) {
  const items: Array<{ label: string; detail: string; href: string; action: string; tone: 'warn' | 'bad' }> = [];
  const missing = services.filter((service) => service.mode !== 'disabled' && service.status === 'missing').length;
  const failed = tasks.filter((task) => task.status === 'failed' || task.status === 'blocked').length;
  const fullDisk = metrics.disks.find((disk) => (disk.usedPercent ?? 0) >= 90);
  if (!configured)
    items.push({
      label: 'Finish initial setup',
      detail: 'Choose storage, apps, and sensible defaults.',
      href: '/setup',
      action: 'Finish setup',
      tone: 'warn'
    });
  if (missing > 0)
    items.push({
      label: `${missing} ${missing === 1 ? 'app needs' : 'apps need'} configuration`,
      detail: 'Review enabled apps and connection details.',
      href: '/stack/services',
      action: 'Configure',
      tone: 'warn'
    });
  if (failed > 0)
    items.push({
      label: `${failed} recent ${failed === 1 ? 'action needs' : 'actions need'} review`,
      detail: 'Open the failure details before deciding whether to retry.',
      href: '/activity/history?status=needs-review',
      action: 'Review failures',
      tone: 'bad'
    });
  if (fullDisk)
    items.push({
      label: `${fullDisk.label} is ${fullDisk.usedPercent}% full`,
      detail: 'Review storage before imports are interrupted.',
      href: '/system/diskspace',
      action: 'Review storage',
      tone: 'bad'
    });
  if (metrics.serviceCounts.dockerRunning === null)
    items.push({
      label: 'Docker status is unavailable',
      detail: 'Stackarr could not read the container runtime.',
      href: '/system/status',
      action: 'Diagnose',
      tone: 'warn'
    });
  return items.slice(0, 4);
}

function heroTitle(configured: boolean, metrics: StackMetrics, appCount: number) {
  if (!configured) return 'Let’s finish shaping your stack.';
  if (appCount === 0) return 'Your homelab is ready for its first app.';
  if (metrics.tasks.failed > 0) return 'Your stack is running. A few things need a look.';
  if (metrics.tasks.running > 0 || metrics.tasks.queued > 0) return 'Your stack is working in the background.';
  return 'Your homelab is ready when you are.';
}

function heroSummary(configured: boolean, metrics: StackMetrics, appCount: number) {
  if (!configured)
    return 'Stackarr keeps complexity out of the way, then lets you peel back the layers when you need them.';
  if (appCount === 0) return 'Your homelab is ready for its first app.';
  const active = metrics.tasks.running + metrics.tasks.queued;
  return `${appCount} enabled apps${active ? ` · ${active} active ${active === 1 ? 'task' : 'tasks'}` : ' · no active work'}.`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

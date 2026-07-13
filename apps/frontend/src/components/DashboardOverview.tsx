import type { StackMetrics } from '@stackarr/core';
import styles from './DashboardOverview.module.css';
import { Grid, Panel, Stat } from './ui';

export function DashboardOverview({ metrics }: { metrics: StackMetrics }) {
  const runningText =
    metrics.serviceCounts.dockerRunning === null
      ? 'Docker unavailable'
      : `${metrics.serviceCounts.dockerRunning} running`;

  return (
    <>
      <Grid>
        <Stat
          label="Services"
          value={`${metrics.serviceCounts.configured}/${metrics.serviceCounts.total} configured`}
          tone="purple"
        />
        <Stat
          label="Docker Runtime"
          value={runningText}
          tone={metrics.serviceCounts.dockerRunning === null ? 'warn' : 'good'}
        />
        <Stat
          label="CPU Load"
          value={`${metrics.performance.cpuLoadPercent}%`}
          tone={metrics.performance.cpuLoadPercent > 80 ? 'bad' : 'neutral'}
        />
        <Stat
          label="Memory Used"
          value={`${metrics.performance.memoryUsedPercent}%`}
          tone={metrics.performance.memoryUsedPercent > 85 ? 'bad' : 'neutral'}
        />
      </Grid>

      <div className={styles.dashboardGrid}>
        <Panel title="Performance">
          <div className={styles.gauges}>
            <Gauge label="CPU" value={metrics.performance.cpuLoadPercent} />
            <Gauge label="Memory" value={metrics.performance.memoryUsedPercent} />
            <Sparkline
              label="Load Average"
              values={metrics.performance.loadAverage.map((value) => Math.round(value * 100))}
            />
          </div>
        </Panel>
      </div>
    </>
  );
}

export function StorageOverview({ metrics }: { metrics: StackMetrics }) {
  const mounted = metrics.disks.filter((disk) => disk.mountPoint !== null);
  const measurable = mounted.filter((disk) => disk.totalSpace !== null && disk.freeSpace !== null);
  const total = measurable.reduce((sum, disk) => sum + (disk.totalSpace ?? 0), 0);
  const free = measurable.reduce((sum, disk) => sum + (disk.freeSpace ?? 0), 0);
  const used = Math.max(0, total - free);

  return (
    <Panel title="Storage" description="Capacity across the mounted drives used by your homelab">
      <div className={styles.storageSummary}>
        <div>
          <span>Total capacity</span>
          <strong>{measurable.length > 0 ? formatBytes(total) : 'Unavailable'}</strong>
        </div>
        <div>
          <span>Used</span>
          <strong>{measurable.length > 0 ? formatBytes(used) : 'Unavailable'}</strong>
        </div>
        <div>
          <span>Available</span>
          <strong>{measurable.length > 0 ? formatBytes(free) : 'Unavailable'}</strong>
        </div>
        <div>
          <span>Mounted drives</span>
          <strong>{mounted.length}</strong>
        </div>
      </div>
      <div className={styles.disks}>
        {metrics.disks.length === 0 && <p>No storage paths configured yet.</p>}
        {metrics.disks.map((disk) => (
          <div key={`${disk.filesystem}-${disk.mountPoint}`} className={styles.diskRow}>
            <div>
              <strong>{disk.label}</strong>
              <span>
                {disk.usedPercent === null
                  ? disk.mountPoint
                    ? 'Mounted · Capacity unavailable'
                    : 'Not mounted'
                  : `${formatBytes((disk.totalSpace ?? 0) - (disk.freeSpace ?? 0))} of ${formatBytes(
                      disk.totalSpace ?? 0
                    )} used · ${formatBytes(disk.freeSpace ?? 0)} available${
                      disk.paths.length > 1 ? ` · ${disk.paths.length} Stackarr locations` : ''
                    }`}
              </span>
            </div>
            <strong className={styles.diskPercent}>{disk.usedPercent === null ? '—' : `${disk.usedPercent}%`}</strong>
            <Bar value={disk.usedPercent ?? 0} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Gauge({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.gauge}>
      <svg viewBox="0 0 120 70" aria-label={`${label} ${value}%`}>
        <path d="M15 60a45 45 0 0 1 90 0" pathLength="100" className={styles.track} />
        <path
          d="M15 60a45 45 0 0 1 90 0"
          pathLength="100"
          className={styles.fill}
          style={{ strokeDasharray: `${value} 100` }}
        />
      </svg>
      <strong>{value}%</strong>
      <span>{label}</span>
    </div>
  );
}

function Sparkline({ label, values }: { label: string; values: number[] }) {
  const max = Math.max(...values, 100);
  const points = values.map((value, index) => `${index * 50},${48 - (value / max) * 42}`).join(' ');

  return (
    <div className={styles.sparkline}>
      <span>{label}</span>
      <svg viewBox="0 0 100 52" preserveAspectRatio="none">
        <polyline className={styles.sparklineLine} points={points} fill="none" strokeWidth="3" />
      </svg>
    </div>
  );
}

function Bar({ value }: { value: number }) {
  return (
    <div className={`${styles.bar} ${value >= 90 ? styles.barBad : value >= 75 ? styles.barWarn : styles.barGood}`}>
      <span style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const amount = value / 1024 ** index;
  return `${amount.toFixed(amount >= 100 || index === 0 ? 0 : amount >= 10 ? 1 : 2)} ${units[index]}`;
}

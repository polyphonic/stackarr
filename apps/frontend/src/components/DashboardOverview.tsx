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

        <Panel title="Storage">
          <div className={styles.disks}>
            {metrics.disks.length === 0 && <p>No storage paths configured yet.</p>}
            {metrics.disks.map((disk) => (
              <div key={disk.path} className={styles.diskRow}>
                <div>
                  <strong>{disk.label}</strong>
                  <span>
                    {disk.usedPercent === null
                      ? 'Not mounted'
                      : `${disk.usedPercent}% used${disk.paths.length > 1 ? ` by ${disk.paths.length} Stackarr paths` : ''}`}
                  </span>
                </div>
                <Bar value={disk.usedPercent ?? 0} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
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
    <div className={styles.bar}>
      <span style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

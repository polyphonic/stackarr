'use client';

import type { HomelabPerformance, HomelabPerformancePoint } from '@stackarr/core';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { stackarrFetch } from './clientApi';
import { InteractiveLineChart, type LineChartSeries } from './InteractiveLineChart';
import styles from './PerformanceOverview.module.css';

export function PerformanceOverview({ initial }: { initial: HomelabPerformance }) {
  const [performance, setPerformance] = useState(initial);
  const [refreshSeconds, setRefreshSeconds] = useState(6);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void stackarrFetch('/api/v1/performance')
        .then(async (response) => (response.ok ? ((await response.json()) as HomelabPerformance) : null))
        .then((next) => {
          if (next?.available) setPerformance((current) => mergePerformance(current, next));
        })
        .catch(() => undefined);
    };
    const interval = window.setInterval(() => {
      refresh();
    }, refreshSeconds * 1000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refreshSeconds]);

  if (!performance.available) {
    return (
      <section className={styles.unavailable} aria-labelledby="performance-title">
        <div>
          <span>Performance</span>
          <h2 id="performance-title">Live resource history</h2>
          <p>{performance.note}</p>
        </div>
        <Link href="/containers">Open Infrastructure</Link>
      </section>
    );
  }

  const latest = performance.points.at(-1);
  return (
    <section className={styles.shell} aria-labelledby="performance-title">
      <header className={styles.header}>
        <div>
          <span>Performance</span>
          <h2 id="performance-title">Your homelab, over time</h2>
          <p>
            {performance.sourceLabel} · refreshed {formatTime(performance.generatedAt)}
          </p>
          {performance.note && <p>{performance.note}</p>}
        </div>
        <div className={styles.current} aria-label="Current performance">
          <Metric label="Host CPU" value={latest?.hostCpuPercent ?? 0} />
          <Metric label="Host memory" value={latest?.hostMemoryPercent ?? 0} />
          <label className={styles.intervalControl}>
            <span>Update every</span>
            <select value={refreshSeconds} onChange={(event) => setRefreshSeconds(Number(event.target.value))}>
              <option value={1}>1 second</option>
              <option value={3}>3 seconds</option>
              <option value={6}>6 seconds</option>
              <option value={10}>10 seconds</option>
            </select>
          </label>
          <Link href="/containers">All containers</Link>
        </div>
      </header>
      <div className={styles.charts}>
        <ResourceChart
          appKey="appCpuPercent"
          appLabel={performance.appLabel}
          hostKey="hostCpuPercent"
          label="CPU usage"
          points={performance.points}
        />
        <ResourceChart
          appKey="appMemoryPercent"
          appLabel={performance.appLabel}
          hostKey="hostMemoryPercent"
          label="Memory usage"
          points={performance.points}
        />
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{formatPercent(value)}</strong>
    </div>
  );
}

function ResourceChart({
  appKey,
  appLabel,
  hostKey,
  label,
  points
}: {
  appKey: 'appCpuPercent' | 'appMemoryPercent';
  appLabel?: string;
  hostKey: 'hostCpuPercent' | 'hostMemoryPercent';
  label: string;
  points: HomelabPerformancePoint[];
}) {
  const latestAt = points.at(-1)?.at ?? Math.floor(Date.now() / 1000);
  const windowedPoints = points.filter((point) => point.at >= latestAt - 120);
  const series: LineChartSeries[] = [
    {
      name: 'System',
      color: 'var(--accent)',
      data: windowedPoints.map((point) => ({
        x: point.at - latestAt,
        y: point[hostKey],
        tooltip: `System · ${formatPercent(point[hostKey])} · ${formatRelativeTime(point.at - latestAt)}`
      }))
    },
    ...(appLabel
      ? [
          {
            name: appLabel,
            color: 'var(--success)',
            data: windowedPoints.map((point) => ({
              x: point.at - latestAt,
              y: point[appKey],
              tooltip: `${appLabel} · ${formatPercent(point[appKey])} · ${formatRelativeTime(point.at - latestAt)}`
            }))
          }
        ]
      : [])
  ];

  return (
    <article className={styles.chart}>
      <header>
        <div>
          <strong>{label}</strong>
          <span>2 min live window</span>
        </div>
        <div className={styles.legend} aria-label="Chart legend">
          <span>
            <i className={styles.hostDot} />
            System
          </span>
          {appLabel && (
            <span>
              <i className={styles.appDot} />
              {appLabel}
            </span>
          )}
        </div>
      </header>
      <div aria-label={`${label} history`} className={styles.victoryChart} role="img">
        <InteractiveLineChart
          height={190}
          series={series}
          xDomain={[-120, 0]}
          xTickFormat={formatAxisTime}
          xTickValues={[-120, -100, -80, -60, -40, -20, 0]}
        />
      </div>
    </article>
  );
}

function mergePerformance(current: HomelabPerformance, next: HomelabPerformance): HomelabPerformance {
  if (next.provider === 'plex' || current.provider !== next.provider || current.appLabel !== next.appLabel) return next;
  const byTime = new Map(current.points.map((point) => [point.at, point]));
  for (const point of next.points) byTime.set(point.at, point);
  const merged = [...byTime.values()].sort((a, b) => a.at - b.at);
  const latestAt = merged.at(-1)?.at ?? 0;
  return { ...next, points: merged.filter((point) => point.at >= latestAt - 120) };
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'now' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatAxisTime(value: number) {
  if (value === 0) return 'Now';
  const totalSeconds = Math.abs(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

function formatRelativeTime(value: number) {
  if (value >= -1) return 'Now';
  return `${formatAxisTime(value)} ago`;
}

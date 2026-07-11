'use client';

import type { HomelabPerformance, HomelabPerformancePoint } from '@stackarr/core';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { stackarrFetch } from './clientApi';
import styles from './PerformanceOverview.module.css';

export function PerformanceOverview({ initial }: { initial: HomelabPerformance }) {
  const [performance, setPerformance] = useState(initial);

  useEffect(() => {
    if (!performance.available) return undefined;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void stackarrFetch('/api/v1/performance')
        .then(async (response) => (response.ok ? ((await response.json()) as HomelabPerformance) : null))
        .then((next) => {
          if (next?.available) setPerformance(next);
        })
        .catch(() => undefined);
    }, 45_000);
    return () => window.clearInterval(interval);
  }, [performance.available]);

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
        </div>
        <div className={styles.current} aria-label="Current performance">
          <Metric label="Host CPU" value={latest?.hostCpuPercent ?? 0} />
          <Metric label="Host memory" value={latest?.hostMemoryPercent ?? 0} />
          <Link href="/containers">All containers</Link>
        </div>
      </header>
      <div className={styles.charts}>
        <ResourceChart appKey="appCpuPercent" hostKey="hostCpuPercent" label="CPU usage" points={performance.points} />
        <ResourceChart
          appKey="appMemoryPercent"
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
  hostKey,
  label,
  points
}: {
  appKey: 'appCpuPercent' | 'appMemoryPercent';
  hostKey: 'hostCpuPercent' | 'hostMemoryPercent';
  label: string;
  points: HomelabPerformancePoint[];
}) {
  const width = 620;
  const height = 160;
  const top = 12;
  const bottom = 24;
  const values = points.flatMap((point) => [point[hostKey], point[appKey]]);
  const maximum = Math.max(20, Math.ceil(Math.max(...values, 0) / 10) * 10);
  const line = (key: typeof appKey | typeof hostKey) =>
    points
      .map((point, index) => {
        const x = points.length <= 1 ? width : (index / (points.length - 1)) * width;
        const y = top + (1 - Math.min(point[key], maximum) / maximum) * (height - top - bottom);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <article className={styles.chart}>
      <header>
        <div>
          <strong>{label}</strong>
          <span>Last {historyWindow(points)}</span>
        </div>
        <div className={styles.legend} aria-label="Chart legend">
          <span>
            <i className={styles.hostDot} />
            System
          </span>
          <span>
            <i className={styles.appDot} />
            Plex
          </span>
        </div>
      </header>
      <svg aria-label={`${label} history`} role="img" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {[0, 0.5, 1].map((position) => (
          <line
            className={styles.gridLine}
            key={position}
            x1="0"
            x2={width}
            y1={top + position * (height - top - bottom)}
            y2={top + position * (height - top - bottom)}
          />
        ))}
        <polyline className={styles.hostLine} fill="none" points={line(hostKey)} vectorEffect="non-scaling-stroke" />
        <polyline className={styles.appLine} fill="none" points={line(appKey)} vectorEffect="non-scaling-stroke" />
      </svg>
      <div className={styles.axis} aria-hidden="true">
        <span>Earlier</span>
        <span>Now</span>
      </div>
    </article>
  );
}

function historyWindow(points: HomelabPerformancePoint[]) {
  if (points.length < 2) return 'a few moments';
  const seconds = Math.max(0, points.at(-1)!.at - points[0].at);
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min`;
}

function formatPercent(value: number) {
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'now' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

'use client';

import type { StackarrTask } from '@stackarr/core';
import { useEffect, useMemo, useState } from 'react';
import styles from './TaskProgress.module.css';

type LiveTaskOptions = {
  activeOnly?: boolean;
  limit?: number;
};

type ParsedTaskProgress = {
  message: string;
  percent?: number;
};

export function useLiveTasks(initialTasks: StackarrTask[], options: LiveTaskOptions = {}) {
  const { activeOnly = false, limit } = options;
  const [tasks, setTasks] = useState(() => shapeTasks(initialTasks, { activeOnly, limit }));

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const response = await fetch('/api/v1/task', { cache: 'no-store' });
        if (!response.ok) {
          return;
        }
        const next = (await response.json()) as StackarrTask[];
        if (!cancelled) {
          setTasks(shapeTasks(next, { activeOnly, limit }));
        }
      } catch {
        // Keep the last known task snapshot if a poll misses.
      }
    }

    const interval = window.setInterval(() => void refresh(), 3000);
    void refresh();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeOnly, limit]);

  return tasks;
}

export function TaskProgressView({ task }: { task: StackarrTask }) {
  const progress = useMemo(() => parseTaskProgress(task), [task]);

  if (!progress) {
    return null;
  }

  const percent = progress.percent ?? (task.status === 'completed' ? 100 : undefined);
  const isRunning = task.status === 'running' || task.status === 'queued';

  return (
    <div className={styles.progress} aria-label={`${task.commandLabel} progress`}>
      <div className={styles.track}>
        <div
          className={`${styles.fill} ${percent === undefined && isRunning ? styles.indeterminate : ''}`}
          style={percent === undefined ? undefined : { width: `${percent}%` }}
        />
      </div>
      <div className={styles.meta}>
        <span>{progress.message}</span>
        {percent !== undefined && <strong>{percent}%</strong>}
      </div>
    </div>
  );
}

function shapeTasks(tasks: StackarrTask[], options: LiveTaskOptions) {
  const activeTasks = options.activeOnly
    ? tasks.filter((task) => task.status === 'queued' || task.status === 'running')
    : tasks;

  return typeof options.limit === 'number' ? activeTasks.slice(0, options.limit) : activeTasks;
}

function parseTaskProgress(task: StackarrTask): ParsedTaskProgress | undefined {
  const lines = outputLines(task);
  const latestProgress = [...lines].reverse().find((line) => line.startsWith('PROGRESS '));

  if (latestProgress) {
    const match = latestProgress.match(/^PROGRESS\s+(\d{1,3})\s+(.+)$/);
    if (match) {
      return {
        percent: clampPercent(Number(match[1])),
        message: match[2]
      };
    }
    return { message: latestProgress.replace(/^PROGRESS\s+/, '') };
  }

  if (task.status === 'queued') {
    return { percent: 0, message: 'Waiting to start' };
  }

  if (task.status === 'running') {
    return { message: latestMeaningfulLine(lines) ?? 'Running' };
  }

  if (task.status === 'completed') {
    const createdLine = latestCreatedLine(lines);
    return createdLine ? { percent: 100, message: createdLine } : undefined;
  }

  if (task.status === 'failed') {
    const message = latestMeaningfulLine(lines) ?? task.error;
    return message ? { message } : undefined;
  }

  return undefined;
}

function outputLines(task: StackarrTask) {
  return (task.output ?? '')
    .split('\n')
    .map((line) => line.replace(/\u001b\[[0-9;]*m/g, '').trim())
    .filter(Boolean);
}

function latestMeaningfulLine(lines: string[]) {
  return [...lines].reverse().find((line) => !line.startsWith('PROGRESS '));
}

function latestCreatedLine(lines: string[]) {
  return [...lines].reverse().find((line) => line.includes('Created '));
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

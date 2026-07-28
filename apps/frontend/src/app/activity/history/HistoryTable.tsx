'use client';

import type { StackarrTask, TaskStatus } from '@stackarr/core';
import { Button } from '@stackarr/ui';
import { toast } from '@stackarr/ui/toast';
import { useDeferredValue, useMemo, useState } from 'react';
import { stackarrFetch } from '../../../components/clientApi';
import { TaskProgressView, useLiveTasks } from '../../../components/TaskProgress';
import { Badge, Panel, SearchInput, Table } from '../../../components/ui';
import styles from './HistoryTable.module.css';

type HistoryStatusFilter =
  | 'all'
  | 'needs-review'
  | 'reviewed'
  | Extract<TaskStatus, 'completed' | 'failed' | 'blocked'>;

const pageSize = 20;

export default function HistoryTable({
  initialTasks,
  initialStatus = 'all'
}: {
  initialTasks: StackarrTask[];
  initialStatus?: HistoryStatusFilter;
}) {
  const liveTasks = useLiveTasks(initialTasks);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>(initialStatus);
  const [page, setPage] = useState(0);
  const [busyKey, setBusyKey] = useState('');
  const [reviewOverrides, setReviewOverrides] = useState<Record<string, string | null>>({});
  const normalizedSearch = useDeferredValue(searchTerm.trim().toLowerCase());
  const tasks = useMemo(
    () =>
      liveTasks.map((task) =>
        Object.hasOwn(reviewOverrides, task.id) ? { ...task, reviewedAt: reviewOverrides[task.id] } : task
      ),
    [liveTasks, reviewOverrides]
  );
  const reviewable = useMemo(() => tasks.filter((task) => needsReview(task)), [tasks]);
  const filtered = useMemo(() => {
    const matchesSearch = tasks.filter(
      (task) =>
        !normalizedSearch ||
        [task.commandLabel, task.status, task.error, task.output]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(normalizedSearch)
    );

    if (statusFilter === 'needs-review') {
      return matchesSearch.filter(needsReview);
    }
    if (statusFilter === 'reviewed') {
      return matchesSearch.filter((task) => isReviewableStatus(task) && Boolean(task.reviewedAt));
    }
    if (statusFilter !== 'all') {
      return matchesSearch.filter((task) => task.status === statusFilter);
    }
    return matchesSearch;
  }, [normalizedSearch, statusFilter, tasks]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);

  async function updateReview(ids: string[], reviewed: boolean, requestKey = ids[0] ?? 'bulk') {
    setBusyKey(requestKey);
    const toastId = toast.loading(reviewed ? 'Marking actions reviewed…' : 'Reopening actions…');
    try {
      const response = await stackarrFetch('/api/v1/task', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ids, reviewed })
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        tasks?: StackarrTask[];
        updated?: number;
      };
      if (!response.ok) {
        throw new Error(body.message || 'Action history could not be updated.');
      }

      const updates = new Map((body.tasks ?? []).map((task) => [task.id, task.reviewedAt ?? null]));
      setReviewOverrides((current) => {
        const next = { ...current };
        for (const id of ids) {
          next[id] = updates.get(id) ?? (reviewed ? new Date().toISOString() : null);
        }
        return next;
      });
      toast.success(
        reviewed
          ? `${body.updated ?? ids.length} ${ids.length === 1 ? 'action' : 'actions'} marked reviewed.`
          : 'Action returned to needs review.',
        { id: toastId }
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Action history could not be updated.', { id: toastId });
    } finally {
      setBusyKey('');
    }
  }

  return (
    <>
      <div className={styles.toolbar}>
        <SearchInput
          value={searchTerm}
          onChange={(value) => {
            setSearchTerm(value);
            setPage(0);
          }}
          placeholder="Search history..."
        />
        <select
          aria-label="Filter action history"
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value as HistoryStatusFilter);
            setPage(0);
          }}
        >
          <option value="all">All actions</option>
          <option value="needs-review">Needs review ({reviewable.length})</option>
          <option value="reviewed">Reviewed failures</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="blocked">Blocked</option>
        </select>
        {reviewable.length > 0 && (
          <Button
            isDisabled={Boolean(busyKey) && busyKey !== 'bulk'}
            isPending={busyKey === 'bulk'}
            onPress={() =>
              void updateReview(
                reviewable.map((task) => task.id),
                true,
                'bulk'
              )
            }
            size="sm"
            variant="secondary"
          >
            Mark all reviewed
          </Button>
        )}
      </div>
      <Panel
        title={`Action History (${filtered.length})`}
        description="Failures keep their original result after review, while leaving the active attention list."
      >
        <div className={styles.tableWrap}>
          <Table>
            <thead>
              <tr>
                <th>Command</th>
                <th>Status</th>
                <th>Queued</th>
                <th>Ended</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5}>No matching entries.</td>
                </tr>
              )}
              {visible.map((task) => (
                <tr key={task.id}>
                  <td>
                    {task.commandLabel}
                    <TaskProgressView task={task} />
                  </td>
                  <td>
                    <Badge tone={taskTone(task)}>{task.status}</Badge>
                  </td>
                  <td>{formatDate(task.queuedAt)}</td>
                  <td>{task.endedAt ? formatDate(task.endedAt) : '—'}</td>
                  <td>
                    {isReviewableStatus(task) ? (
                      <div className={styles.reviewCell}>
                        {task.reviewedAt && <small>Reviewed {formatDate(task.reviewedAt)}</small>}
                        <Button
                          isDisabled={Boolean(busyKey) && busyKey !== task.id}
                          isPending={busyKey === task.id}
                          onPress={() => void updateReview([task.id], !task.reviewedAt)}
                          size="sm"
                          variant={task.reviewedAt ? 'tertiary' : 'secondary'}
                        >
                          {task.reviewedAt ? 'Reopen' : 'Mark reviewed'}
                        </Button>
                      </div>
                    ) : (
                      <span className={styles.complete}>Complete</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <footer className={styles.pagination}>
          <span>
            {filtered.length === 0 ? 0 : safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, filtered.length)}{' '}
            of {filtered.length}
          </span>
          <div>
            <Button
              isDisabled={safePage === 0}
              onPress={() => setPage((current) => Math.max(0, current - 1))}
              size="sm"
              variant="tertiary"
            >
              Previous
            </Button>
            <Button
              isDisabled={safePage >= pageCount - 1}
              onPress={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
              size="sm"
              variant="tertiary"
            >
              Next
            </Button>
          </div>
        </footer>
      </Panel>
    </>
  );
}

function isReviewableStatus(task: StackarrTask) {
  return task.status === 'failed' || task.status === 'blocked';
}

function needsReview(task: StackarrTask) {
  return isReviewableStatus(task) && !task.reviewedAt;
}

function taskTone(task: StackarrTask) {
  if (task.status === 'failed') return 'bad' as const;
  if (task.status === 'blocked') return 'warn' as const;
  if (task.status === 'completed') return 'good' as const;
  return 'purple' as const;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

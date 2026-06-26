'use client';

import type { StackarrTask, TaskStatus } from '@stackarr/core';
import { useState } from 'react';
import { TaskProgressView, useLiveTasks } from '../../../components/TaskProgress';
import { Badge, Panel, SearchInput, Table } from '../../../components/ui';

type HistoryStatusFilter = 'all' | Extract<TaskStatus, 'completed' | 'failed'>;

export default function HistoryTable({ initialTasks }: { initialTasks: StackarrTask[] }) {
  const tasks = useLiveTasks(initialTasks);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('all');
  const normalizedSearch = searchTerm.trim().toLowerCase();

  let filtered = tasks.filter(
    (task) =>
      !normalizedSearch ||
      task.commandLabel.toLowerCase().includes(normalizedSearch) ||
      task.status.toLowerCase().includes(normalizedSearch)
  );

  if (statusFilter !== 'all') {
    filtered = filtered.filter((task) => task.status === statusFilter);
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search history..." />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as HistoryStatusFilter)}
          style={{
            background: 'var(--input-bg)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            padding: '6px 10px',
            borderRadius: '6px',
            fontSize: '12px'
          }}
        >
          <option value="all">All statuses</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <Panel title={`Command History (${filtered.length})`}>
        <Table>
          <thead>
            <tr>
              <th>Command</th>
              <th>Status</th>
              <th>Queued</th>
              <th>Ended</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4}>No matching entries.</td>
              </tr>
            )}
            {filtered.map((task) => (
              <tr key={task.id}>
                <td>
                  {task.commandLabel}
                  <TaskProgressView task={task} />
                </td>
                <td>
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
                </td>
                <td>{task.queuedAt}</td>
                <td>{task.endedAt ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}

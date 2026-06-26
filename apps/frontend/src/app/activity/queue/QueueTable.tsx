'use client';

import type { StackarrTask } from '@stackarr/core';
import { useState } from 'react';
import { TaskProgressView, useLiveTasks } from '../../../components/TaskProgress';
import { Badge, Panel, SearchInput, Table } from '../../../components/ui';

export default function QueueTable({ initialTasks }: { initialTasks: StackarrTask[] }) {
  const tasks = useLiveTasks(initialTasks, { activeOnly: true });
  const [searchTerm, setSearchTerm] = useState('');
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filtered = tasks.filter(
    (task) =>
      !normalizedSearch ||
      task.commandLabel.toLowerCase().includes(normalizedSearch) ||
      task.status.toLowerCase().includes(normalizedSearch)
  );

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search commands..." />
      </div>
      <Panel title={`Active Queue (${filtered.length})`}>
        <Table className="queue-table">
          <thead>
            <tr>
              <th>Command</th>
              <th>Status</th>
              <th>Started / Queued</th>
              <th>ID</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4}>No active commands match search.</td>
              </tr>
            )}
            {filtered.map((task) => (
              <tr key={task.id}>
                <td>
                  {task.commandLabel}
                  <TaskProgressView task={task} />
                </td>
                <td>
                  <Badge tone={task.status === 'running' ? 'good' : 'purple'}>{task.status}</Badge>
                </td>
                <td>{task.startedAt ?? task.queuedAt}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '11px', color: 'var(--muted)' }}>
                  {task.id.slice(0, 8)}...
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}

'use client';

import type { getSystemStatus, ServiceSummary, StackarrTask, StackMetrics } from '@stackarr/core';
import { useState } from 'react';
import { DashboardOverview } from './DashboardOverview';
import { ServiceLogo } from './ServiceLogo';
import { TaskProgressView, useLiveTasks } from './TaskProgress';
import { Badge, Grid, Panel, SearchInput, Stat, Table } from './ui';

type SystemStatus = ReturnType<typeof getSystemStatus>;

export function DashboardClient({
  status,
  services,
  metrics,
  tasks
}: {
  status: SystemStatus;
  services: ServiceSummary[];
  metrics: StackMetrics;
  tasks: StackarrTask[];
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const liveTasks = useLiveTasks(tasks, { limit: 5 });
  const normalizedSearch = searchTerm.trim().toLowerCase();

  const filteredServices = services
    .filter((service) => service.name !== 'stackarr')
    .filter(
      (service) =>
        !normalizedSearch ||
        service.displayName.toLowerCase().includes(normalizedSearch) ||
        service.category.toLowerCase().includes(normalizedSearch) ||
        service.status.toLowerCase().includes(normalizedSearch)
    );

  return (
    <>
      <Grid>
        <Stat
          label="Configuration"
          value={status.configured ? 'Ready' : 'Needs setup'}
          tone={status.configured ? 'good' : 'warn'}
        />
        <Stat label="Torrent Client" value={String(status.torrentClient)} tone="purple" />
        <Stat label="Plex Mode" value={String(status.plexInstallMode)} tone="neutral" />
        <Stat label="Jellyfin Mode" value={String(status.jellyfinInstallMode)} tone="neutral" />
      </Grid>

      <DashboardOverview metrics={metrics} />

      <Panel
        title="Services"
        action={
          <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Filter services..." className="" />
        }
      >
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Mode</th>
              <th>Status</th>
              <th>Link</th>
            </tr>
          </thead>
          <tbody>
            {filteredServices.length === 0 && (
              <tr>
                <td colSpan={5}>No services match your search.</td>
              </tr>
            )}
            {filteredServices.map((service) => {
              const link = service.browserUrl ?? service.localUrl;
              return (
                <tr key={service.name}>
                  <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ServiceLogo name={service.name} size={22} /> {service.displayName}
                  </td>
                  <td>{service.category}</td>
                  <td>
                    <Badge tone={service.mode === 'disabled' ? 'warn' : 'purple'}>{service.mode}</Badge>
                  </td>
                  <td>
                    <Badge tone={service.status === 'configured' ? 'good' : 'warn'}>{service.status}</Badge>
                  </td>
                  <td>
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer">
                        {link}
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Panel>

      <Panel title="Recent Tasks">
        <Table>
          <thead>
            <tr>
              <th>Command</th>
              <th>Status</th>
              <th>Queued</th>
            </tr>
          </thead>
          <tbody>
            {liveTasks.length === 0 && (
              <tr>
                <td colSpan={3}>No queued tasks yet.</td>
              </tr>
            )}
            {liveTasks.map((task) => (
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
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  );
}

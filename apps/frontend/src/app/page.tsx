import { getServices, getStackMetrics, getSystemStatus, readEnv, readTasks } from '@stackarr/core';
import { PageBody, Toolbar } from '../components/AppFrame';
import { CommandButton } from '../components/CommandButton';
import { DashboardClient } from '../components/DashboardClient';
import { requireDashboardAuth } from '../lib/serverAuth';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await requireDashboardAuth('/');

  const status = getSystemStatus();
  const services = getServices();
  const env = readEnv();
  const metrics = getStackMetrics([
    env.MEDIA_ROOT ?? '',
    env.MUSIC_ROOT ?? '',
    env.DOWNLOADS_ROOT ?? '',
    env.BACKUP_ROOT ?? ''
  ]);
  const tasks = readTasks().slice(0, 5);

  return (
    <>
      <Toolbar
        title="Dashboard"
        actions={
          <>
            <CommandButton name="StackStart" label="Start" disruptive />
            <CommandButton name="StackConfigure" label="Configure" disruptive />
          </>
        }
      />
      <PageBody>
        <DashboardClient status={status} services={services} metrics={metrics} tasks={tasks} />
      </PageBody>
    </>
  );
}

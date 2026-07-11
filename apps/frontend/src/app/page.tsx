import {
  getHomelabPerformanceAction,
  getServices,
  getStackMetrics,
  getSystemStatus,
  listServiceFavoritesAction,
  readEnv,
  readTasks
} from '@stackarr/core';
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
    env.BACKUP_ROOT ?? '',
    env.BOOKS_ROOT ?? '',
    env.IMMICH_UPLOAD_LOCATION ?? '',
    env.GAMES_ROOT ?? ''
  ]);
  const tasks = readTasks().slice(0, 5);
  const favoriteNames = listServiceFavoritesAction().map((favorite) => favorite.name);
  const performance = await getHomelabPerformanceAction();

  return (
    <>
      <Toolbar
        title="Home"
        description="Health, active work, and the apps you use every day"
        actions={
          status.configured ? (
            metrics.serviceCounts.dockerRunning === 0 ? (
              <CommandButton name="StackStart" label="Start stack" disruptive />
            ) : null
          ) : (
            <CommandButton name="StackConfigure" label="Finish setup" disruptive />
          )
        }
      />
      <PageBody>
        <DashboardClient
          favoriteNames={favoriteNames}
          status={status}
          services={services}
          metrics={metrics}
          performance={performance}
          tasks={tasks}
        />
      </PageBody>
    </>
  );
}

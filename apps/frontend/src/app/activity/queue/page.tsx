import { readTasks } from '@stackarr/core';
import { ActivityNav } from '../../../components/ActivityNav';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { requireDashboardAuth } from '../../../lib/serverAuth';
import QueueTable from './QueueTable';

export const dynamic = 'force-dynamic';

export default async function QueuePage() {
  await requireDashboardAuth('/activity/queue');

  const allTasks = readTasks();
  const queueTasks = allTasks.filter((task) => task.status === 'queued' || task.status === 'running');

  return (
    <>
      <Toolbar title="Activity" description="Active work, action history, and the server trail in one place" />
      <PageBody>
        <ActivityNav />
        <QueueTable initialTasks={queueTasks} />
      </PageBody>
    </>
  );
}

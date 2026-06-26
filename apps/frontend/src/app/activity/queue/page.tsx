import { readTasks } from '@stackarr/core';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import QueueTable from './QueueTable';

export const dynamic = 'force-dynamic';

export default function QueuePage() {
  const allTasks = readTasks();
  const queueTasks = allTasks.filter((task) => task.status === 'queued' || task.status === 'running');

  return (
    <>
      <Toolbar title="Queue" />
      <PageBody>
        <QueueTable initialTasks={queueTasks} />
      </PageBody>
    </>
  );
}

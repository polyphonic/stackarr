import { readTasks } from '@stackarr/core';
import { ActivityNav } from '../../../components/ActivityNav';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { requireDashboardAuth } from '../../../lib/serverAuth';
import HistoryTable from './HistoryTable';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  await requireDashboardAuth('/activity/history');

  const allTasks = readTasks();

  return (
    <>
      <Toolbar title="Activity" description="Active work, action history, and the server trail in one place" />
      <PageBody>
        <ActivityNav />
        <HistoryTable initialTasks={allTasks} />
      </PageBody>
    </>
  );
}

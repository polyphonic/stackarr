import { readTasks } from '@stackarr/core';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { requireDashboardAuth } from '../../../lib/serverAuth';
import HistoryTable from './HistoryTable';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  await requireDashboardAuth('/activity/history');

  const allTasks = readTasks();

  return (
    <>
      <Toolbar title="History" />
      <PageBody>
        <HistoryTable initialTasks={allTasks} />
      </PageBody>
    </>
  );
}

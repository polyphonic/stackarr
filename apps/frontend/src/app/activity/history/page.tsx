import { readTasks } from '@stackarr/core';
import { ActivityNav } from '../../../components/ActivityNav';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { requireDashboardAuth } from '../../../lib/serverAuth';
import HistoryTable from './HistoryTable';

export const dynamic = 'force-dynamic';

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireDashboardAuth('/activity/history');

  const allTasks = readTasks();
  const { status } = await searchParams;

  return (
    <>
      <Toolbar title="Activity" description="Active work, action history, and the server trail in one place" />
      <PageBody>
        <ActivityNav />
        <HistoryTable initialStatus={status === 'needs-review' ? 'needs-review' : 'all'} initialTasks={allTasks} />
      </PageBody>
    </>
  );
}

import { readTasks } from '@stackarr/core';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import HistoryTable from './HistoryTable';

export const dynamic = 'force-dynamic';

export default function HistoryPage() {
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

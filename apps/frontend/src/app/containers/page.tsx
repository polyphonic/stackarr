import { getDockerOverviewAction } from '@stackarr/core';
import { PageBody, Toolbar } from '../../components/AppFrame';
import { ContainerManager } from '../../components/ContainerManager';
import { requireDashboardAuth } from '../../lib/serverAuth';

export const dynamic = 'force-dynamic';

export default async function ContainersPage() {
  await requireDashboardAuth('/containers');

  const overview = await getDockerOverviewAction();

  return (
    <>
      <Toolbar title="Containers" />
      <PageBody>
        <ContainerManager overview={overview} />
      </PageBody>
    </>
  );
}

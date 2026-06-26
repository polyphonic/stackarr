import { getDockerOverviewAction } from '@stackarr/core';
import { PageBody, Toolbar } from '../../components/AppFrame';
import { ContainerManager } from '../../components/ContainerManager';

export const dynamic = 'force-dynamic';

export default async function ContainersPage() {
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

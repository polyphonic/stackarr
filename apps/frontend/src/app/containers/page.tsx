import { getDockerContainerOverviewAction, getServices, readSettings } from '@stackarr/core';
import { PageBody, Toolbar } from '../../components/AppFrame';
import { ContainerManager } from '../../components/ContainerManager';
import { requireDashboardAuth } from '../../lib/serverAuth';

export const dynamic = 'force-dynamic';

export default async function ContainersPage() {
  await requireDashboardAuth('/containers');

  const overview = await getDockerContainerOverviewAction();
  const refreshIntervalSeconds = readSettings().ui.refreshIntervalSeconds;
  const serviceLinks = Object.fromEntries(
    getServices()
      .map((service) => [service.name, service.browserUrl ?? service.localUrl] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
  );

  return (
    <>
      <Toolbar
        title="Infrastructure"
        description="Your stack topology, live container load, and advanced Docker resources"
      />
      <PageBody>
        <ContainerManager
          overview={overview}
          refreshIntervalSeconds={refreshIntervalSeconds}
          serviceLinks={serviceLinks}
        />
      </PageBody>
    </>
  );
}

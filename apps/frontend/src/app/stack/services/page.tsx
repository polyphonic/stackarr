import { getNativeAppCapabilitiesAction, listServiceConfigsAction } from '@stackarr/core';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { DestinationCard } from '../../../components/DestinationCard';
import { icons } from '../../../components/icons';
import { NativeAppActions } from '../../../components/NativeAppActions';
import { ServiceDirectory } from '../../../components/ServiceDirectory';
import { Grid, Panel } from '../../../components/ui';
import { requireDashboardAuth } from '../../../lib/serverAuth';

export const dynamic = 'force-dynamic';

export default async function StackPage() {
  await requireDashboardAuth('/stack/services');

  const configs = listServiceConfigsAction();
  const nativeCapabilities = getNativeAppCapabilitiesAction();

  return (
    <>
      <Toolbar title="Apps" description="Open, organize, and configure the services that make up your homelab" />
      <PageBody>
        <Grid>
          <DestinationCard
            href="/downloaders"
            icon={icons.download}
            title="Downloads"
            description="Day-to-day download and music import workflows"
          />
          <DestinationCard
            href="/stack/media-servers"
            icon={icons.tv}
            title="Media servers"
            description="Plex and Jellyfin ownership and connections"
          />
          <DestinationCard
            href="/containers"
            icon={icons.containers}
            title="Infrastructure"
            description="See how apps, containers, storage, and networks fit together"
          />
          <DestinationCard
            href="/settings/services"
            icon={icons.sliders}
            title="Choose apps"
            description="Enable optional services and advanced instances"
          />
        </Grid>
        <Panel
          title="Everyday app actions"
          description="Run the same focused native operations available to your chat agents"
        >
          <NativeAppActions capabilities={nativeCapabilities} />
        </Panel>
        <Panel title="Your apps" description="Star frequent apps to keep them close in the page header">
          <ServiceDirectory configs={configs} />
        </Panel>
      </PageBody>
    </>
  );
}

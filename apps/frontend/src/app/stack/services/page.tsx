import { listServiceConfigsAction } from '@stackarr/core';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { ServiceDirectory } from '../../../components/ServiceDirectory';
import { Panel } from '../../../components/ui';

export const dynamic = 'force-dynamic';

export default function StackPage() {
  const configs = listServiceConfigsAction();

  return (
    <>
      <Toolbar title="Stack" />
      <PageBody>
        <Panel title="Stack Services">
          <ServiceDirectory configs={configs} />
        </Panel>
      </PageBody>
    </>
  );
}

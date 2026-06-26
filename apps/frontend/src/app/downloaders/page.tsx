import { listServiceConfigsAction } from '@stackarr/core';
import { PageBody, Toolbar } from '../../components/AppFrame';
import { DownloadersDirectory } from '../../components/DownloadersDirectory';
import { Panel } from '../../components/ui';

export default function DownloadersPage() {
  const configs = listServiceConfigsAction().filter((config) => config.service.name === 'streamrip');

  return (
    <>
      <Toolbar title="Downloaders" />
      <PageBody>
        <Panel title="Downloaders">
          <p>
            Configure and run Stackarr-managed downloaders. Lidarr stays the metadata/import brain; Stackarr owns
            Streamrip settings, execution, and agent-accessible MCP tools.
          </p>
          <DownloadersDirectory configs={configs} />
        </Panel>
      </PageBody>
    </>
  );
}

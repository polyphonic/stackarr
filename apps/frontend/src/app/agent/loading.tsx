import { PageBody, Toolbar } from '../../components/AppFrame';
import { PageLoadingSkeleton } from '../../components/PageLoadingSkeleton';

export default function AgentsLoading() {
  return (
    <>
      <Toolbar title="Agents" description="Loading agent actions and connections" />
      <PageBody>
        <PageLoadingSkeleton label="Loading agents" />
      </PageBody>
    </>
  );
}

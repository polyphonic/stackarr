import { PageBody, Toolbar } from '../../../components/AppFrame';
import { PageLoadingSkeleton } from '../../../components/PageLoadingSkeleton';

export default function AppsLoading() {
  return (
    <>
      <Toolbar title="Apps" description="Loading your installed apps and catalog" />
      <PageBody>
        <PageLoadingSkeleton label="Loading apps" />
      </PageBody>
    </>
  );
}

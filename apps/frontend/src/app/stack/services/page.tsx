import { getNativeAppCapabilitiesAction, listServiceConfigsAction } from '@stackarr/core';
import Link from 'next/link';
import { PageBody, Toolbar } from '../../../components/AppFrame';
import { NativeAppActions } from '../../../components/NativeAppActions';
import { ServiceDirectory } from '../../../components/ServiceDirectory';
import { Panel } from '../../../components/ui';
import { requireDashboardAuth } from '../../../lib/serverAuth';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const automaticServices = new Set([
  'stackarr',
  'database',
  'redis',
  'backup',
  'prowlarr',
  'streamrip',
  'radarr4k',
  'sonarr4k'
]);

export default async function AppsPage({ searchParams }: { searchParams: Promise<{ app?: string; add?: string }> }) {
  await requireDashboardAuth('/stack/services');

  const query = await searchParams;
  const configs = listServiceConfigsAction();
  const nativeCapabilities = getNativeAppCapabilitiesAction();
  const installedApps = configs.filter(
    (config) =>
      config.service.experience === 'app' && config.service.mode !== 'disabled' && config.service.name !== 'stackarr'
  );
  const installedHelpers = configs.filter(
    (config) => config.service.experience === 'helper' && config.service.mode !== 'disabled'
  );
  const available = configs.filter(
    (config) =>
      config.service.mode === 'disabled' && config.groups.length > 0 && !automaticServices.has(config.service.name)
  );
  const hasNativeActions = nativeCapabilities.apps.some((app) => app.enabled);
  const initialInstalledApp = query.add ? undefined : query.app;
  const initialAvailableApp = query.add ? query.app : undefined;

  return (
    <>
      <Toolbar
        title="Apps"
        description="Open an app, change its settings, or add something new to your homelab"
        actions={
          <Link className={styles.addButton} href="#add-app">
            <span aria-hidden="true">+</span> Add app
          </Link>
        }
      />
      <PageBody>
        {installedApps.length === 0 ? (
          <section className={styles.emptyState} aria-labelledby="empty-apps-title">
            <span className={styles.emptyMark} aria-hidden="true">
              +
            </span>
            <h2 id="empty-apps-title">Add your first app</h2>
            <p>
              Start with the service you actually want. Stackarr will only show the actions, settings, and helpers that
              make sense for it.
            </p>
            <Link className={styles.primaryLink} href="#add-app">
              Choose an app
            </Link>
          </section>
        ) : (
          <Panel
            title={installedApps.length === 1 ? 'Your app' : 'Your apps'}
            description="Open an app, pin it to the front, or change its connection and behavior"
          >
            <ServiceDirectory configs={installedApps} initialService={initialInstalledApp} />
          </Panel>
        )}

        {hasNativeActions && installedApps.length > 0 && (
          <Panel
            title="App actions"
            description="The useful everyday operations Stackarr can run for you or your agent"
          >
            <NativeAppActions capabilities={nativeCapabilities} />
          </Panel>
        )}

        {installedHelpers.length > 0 && (
          <details className={styles.helpers}>
            <summary>Background helpers ({installedHelpers.length})</summary>
            <p>These services support your apps and usually do not need day-to-day attention.</p>
            <ServiceDirectory configs={installedHelpers} variant="helper" />
          </details>
        )}

        <section id="add-app" className={styles.catalogSection} aria-labelledby="add-app-title">
          <div className={styles.sectionHeading}>
            <div>
              <span>Grow your homelab</span>
              <h2 id="add-app-title">Add an app</h2>
            </div>
            <p>Unavailable apps explain what they need first. Nothing is installed until you save and apply it.</p>
          </div>
          {available.length > 0 ? (
            <ServiceDirectory configs={available} initialService={initialAvailableApp} variant="catalog" />
          ) : (
            <p className={styles.catalogEmpty}>Every available app is already part of this homelab.</p>
          )}
        </section>
      </PageBody>
    </>
  );
}

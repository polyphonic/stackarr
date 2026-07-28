'use client';

import type { AgentActionCatalogEntry, ApiExplorerResult, ApiExplorerSource } from '@stackarr/core';
import { Button, Skeleton } from '@stackarr/ui';
import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import styles from './AgentExplorer.module.css';
import { stackarrFetch } from './clientApi';

type NativeOperation = {
  name: string;
  method: string;
  endpoint: string;
  description: string;
  requiresCredential: boolean;
  requiredInput?: string[];
};

type NativeCapability = {
  app: string;
  enabled: boolean;
  configured: boolean;
  credentialConfigured: boolean;
  notice?: string;
  readOperations: NativeOperation[];
  manageOperations: NativeOperation[];
  dangerousOperations: NativeOperation[];
};

type ExplorerView = 'actions' | 'apis' | 'native';
const actionPageSize = 25;

export function AgentExplorer({
  actions,
  nativeCapabilities
}: {
  actions: AgentActionCatalogEntry[];
  nativeCapabilities: NativeCapability[];
}) {
  const [view, setView] = useState<ExplorerView>('actions');
  const [query, setQuery] = useState('');
  const [contracts, setContracts] = useState<ApiExplorerResult>();
  const [selectedService, setSelectedService] = useState('');
  const [loadError, setLoadError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [actionPage, setActionPage] = useState(0);

  useEffect(() => {
    if (window.location.hash === '#apis' || window.location.hash.startsWith('#api-')) {
      setView('apis');
      void loadContracts(false);
    } else if (window.location.hash === '#native') {
      setView('native');
    }
  }, []);

  function selectView(next: ExplorerView) {
    setView(next);
    setActionPage(0);
    window.history.replaceState(null, '', `#${next}`);
    if (next === 'apis' && !contracts && !refreshing) {
      void loadContracts(false);
    }
  }

  async function loadContracts(force: boolean) {
    setRefreshing(true);
    setLoadError('');
    try {
      const response = await stackarrFetch(`/api/v1/agent/apis${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const body = (await response.json().catch(() => ({}))) as ApiExplorerResult & { error?: string };
      if (!response.ok) throw new Error(body.error || 'Could not discover API contracts.');
      setContracts(body);
      setSelectedService((current) =>
        body.sources.some((source) => source.service === current) ? current : (body.sources[0]?.service ?? '')
      );
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not discover API contracts.');
    } finally {
      setRefreshing(false);
    }
  }

  function showApi(service: string) {
    setView('apis');
    setSelectedService(service);
    window.history.replaceState(null, '', `#api-${service}`);
  }

  const selectedContract = contracts?.sources.find((source) => source.service === selectedService);
  const normalizedQuery = useDeferredValue(query.trim().toLowerCase());
  const endpoints = useMemo(
    () =>
      (selectedContract?.endpoints ?? []).filter((endpoint) =>
        [endpoint.method, endpoint.path, endpoint.summary, endpoint.operationId, ...endpoint.tags]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery))
      ),
    [normalizedQuery, selectedContract]
  );
  const filteredActions = useMemo(
    () =>
      actions.filter((action) =>
        [
          action.name,
          action.category,
          action.description,
          ...action.apiSources.flatMap((source) => [source.label, source.explanation])
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery)
      ),
    [actions, normalizedQuery]
  );
  const actionPageCount = Math.max(1, Math.ceil(filteredActions.length / actionPageSize));
  const safeActionPage = Math.min(actionPage, actionPageCount - 1);
  const visibleActions = filteredActions.slice(
    safeActionPage * actionPageSize,
    safeActionPage * actionPageSize + actionPageSize
  );
  const enabledNativeCapabilities = useMemo(
    () => nativeCapabilities.filter((capability) => capability.enabled),
    [nativeCapabilities]
  );
  const nativeOperationCount = useMemo(
    () =>
      enabledNativeCapabilities.reduce(
        (total, capability) =>
          total +
          capability.readOperations.length +
          capability.manageOperations.length +
          capability.dangerousOperations.length,
        0
      ),
    [enabledNativeCapabilities]
  );

  return (
    <section className={styles.workspace}>
      <div className={styles.workspaceBar}>
        <div className={styles.tabs} role="tablist" aria-label="Agent reference">
          <button
            aria-selected={view === 'actions'}
            className={view === 'actions' ? styles.activeTab : styles.tab}
            onClick={() => selectView('actions')}
            role="tab"
            type="button"
          >
            Agent Actions <span>{actions.length}</span>
          </button>
          <button
            aria-selected={view === 'apis'}
            className={view === 'apis' ? styles.activeTab : styles.tab}
            onClick={() => selectView('apis')}
            role="tab"
            type="button"
          >
            API Explorer <span>{contracts?.sources.length ?? '—'}</span>
          </button>
          <button
            aria-selected={view === 'native'}
            className={view === 'native' ? styles.activeTab : styles.tab}
            onClick={() => selectView('native')}
            role="tab"
            type="button"
          >
            Allowlisted Native Operations <span>{nativeOperationCount}</span>
          </button>
        </div>
        <div className={styles.workspaceTools}>
          <label className={styles.search}>
            <span className={styles.srOnly}>
              Search {view === 'apis' ? 'endpoints' : view === 'native' ? 'native operations' : 'agent actions'}
            </span>
            <input
              onChange={(event) => {
                setQuery(event.target.value);
                setActionPage(0);
              }}
              placeholder={
                view === 'apis'
                  ? 'Search paths, methods, tags…'
                  : view === 'native'
                    ? 'Search apps and operations…'
                    : 'Search actions and API sources…'
              }
              type="search"
              value={query}
            />
          </label>
          <Link className={styles.secondaryAction} href="/agent/settings">
            Connections
          </Link>
        </div>
      </div>

      {view === 'apis' ? (
        <div className={styles.apiLayout}>
          <aside className={styles.sourceRail} aria-label="Discovered API contracts">
            <div className={styles.railHeading}>
              <span>Live Contracts</span>
              <button disabled={refreshing} onClick={() => void loadContracts(true)} type="button">
                {refreshing ? 'Checking…' : 'Refresh'}
              </button>
            </div>
            {!contracts && !loadError ? <ApiSourceSkeleton /> : null}
            {loadError ? <p className={styles.error}>{loadError}</p> : null}
            {contracts?.sources.map((source) => (
              <button
                aria-current={source.service === selectedService ? 'true' : undefined}
                className={source.service === selectedService ? styles.activeSource : styles.source}
                key={source.service}
                onClick={() => showApi(source.service)}
                type="button"
              >
                <span>{source.displayName}</span>
                <small>{source.endpoints.length} endpoints</small>
              </button>
            ))}
            {contracts && contracts.sources.length === 0 ? (
              <p className={styles.muted}>
                No machine-readable contracts were found. Apps without a current OpenAPI or Swagger document are
                intentionally omitted.
              </p>
            ) : null}
            {contracts && contracts.sources.length > 0 ? (
              <p className={styles.discoveryNote}>
                {contracts.sources.length} of {contracts.checkedServices} checked apps publish a usable live contract.
                Apps without one are omitted instead of showing guessed or stale endpoints.
              </p>
            ) : null}
          </aside>

          <div className={styles.contractPane}>
            {!contracts && !loadError ? (
              <ApiContractSkeleton />
            ) : selectedContract ? (
              <ContractView contract={selectedContract} endpoints={endpoints} />
            ) : (
              <div className={styles.emptyState}>
                <h2>API Contracts Stay Tied to Installed Apps</h2>
                <p>
                  Stackarr reads each app’s own contract at runtime. This keeps the endpoint list current and avoids
                  presenting documentation for apps that are not installed.
                </p>
              </div>
            )}
          </div>
        </div>
      ) : view === 'actions' ? (
        <div className={styles.actionPane} id="actions">
          <div className={styles.sectionIntro}>
            <div>
              <h2>Advertised MCP Actions</h2>
              <p>Every action is mapped to the API or local control surface it actually uses.</p>
            </div>
            <Link href="/activity/agents">Review Agent Activity</Link>
          </div>
          <div className={styles.tableScroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Access</th>
                  <th>API Source</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {visibleActions.map((action) => (
                  <tr key={action.name}>
                    <td>
                      <strong>{actionLabel(action.name)}</strong>
                      <code>{action.name}</code>
                    </td>
                    <td>
                      <span className={`${styles.risk} ${styles[action.risk]}`}>{riskLabel(action.risk)}</span>
                    </td>
                    <td>
                      <div className={styles.sourceList}>
                        {action.apiSources.map((source) => {
                          const discovered = source.service
                            ? contracts?.sources.some((contract) => contract.service === source.service)
                            : false;
                          return (
                            <div key={`${action.name}-${source.id}`}>
                              {source.service && discovered ? (
                                <button onClick={() => showApi(source.service!)} type="button">
                                  {source.label}
                                </button>
                              ) : source.configHref ? (
                                <Link href={source.configHref}>{source.label}</Link>
                              ) : (
                                <strong>{source.label}</strong>
                              )}
                              <small>{source.explanation}</small>
                            </div>
                          );
                        })}
                      </div>
                    </td>
                    <td>{action.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <footer className={styles.pagination}>
            <span>
              {filteredActions.length === 0 ? 0 : safeActionPage * actionPageSize + 1}–
              {Math.min((safeActionPage + 1) * actionPageSize, filteredActions.length)} of {filteredActions.length}
            </span>
            <div>
              <Button
                isDisabled={safeActionPage === 0}
                onPress={() => setActionPage((current) => Math.max(0, current - 1))}
                size="sm"
                variant="tertiary"
              >
                Previous
              </Button>
              <Button
                isDisabled={safeActionPage >= actionPageCount - 1}
                onPress={() => setActionPage((current) => Math.min(actionPageCount - 1, current + 1))}
                size="sm"
                variant="tertiary"
              >
                Next
              </Button>
            </div>
          </footer>
        </div>
      ) : (
        <div className={styles.actionPane} id="native">
          <NativeOperations capabilities={enabledNativeCapabilities} query={normalizedQuery} />
        </div>
      )}
    </section>
  );
}

function ApiSourceSkeleton() {
  return (
    <div className={`${styles.sourceSkeleton} skeleton--shimmer`} aria-label="Discovering API contracts">
      <Skeleton animationType="none" />
      <Skeleton animationType="none" />
      <Skeleton animationType="none" />
      <Skeleton animationType="none" />
    </div>
  );
}

function ApiContractSkeleton() {
  return (
    <div className={`${styles.contractSkeleton} skeleton--shimmer`} aria-label="Loading API contract">
      <Skeleton animationType="none" />
      <Skeleton animationType="none" />
      <Skeleton animationType="none" />
    </div>
  );
}

function ContractView({
  contract,
  endpoints
}: {
  contract: ApiExplorerSource;
  endpoints: ApiExplorerSource['endpoints'];
}) {
  return (
    <div id={`api-${contract.service}`}>
      <header className={styles.contractHeader}>
        <div>
          <span className={styles.eyebrow}>Machine-Readable Contract</span>
          <h2>{contract.contractTitle}</h2>
          <p>{contract.description}</p>
        </div>
        <div className={styles.contractActions}>
          <Link href={contract.configHref}>Configure in Apps</Link>
          {contract.browserUrl ? (
            <a href={contract.browserUrl} rel="noreferrer" target="_blank">
              Open App
            </a>
          ) : null}
        </div>
      </header>
      <dl className={styles.contractMeta}>
        <div>
          <dt>Contract</dt>
          <dd>{contract.contractPath}</dd>
        </div>
        <div>
          <dt>API Version</dt>
          <dd>{contract.contractVersion || 'Not declared'}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{contract.openApiVersion || 'OpenAPI / Swagger'}</dd>
        </div>
      </dl>
      <div className={styles.tableScroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Method</th>
              <th>Path</th>
              <th>Summary</th>
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((endpoint) => (
              <tr key={`${endpoint.method}-${endpoint.path}`}>
                <td>
                  <span className={`${styles.method} ${styles[endpoint.method.toLowerCase()]}`}>{endpoint.method}</span>
                </td>
                <td>
                  <code>{endpoint.path}</code>
                  {endpoint.operationId ? <small>{endpoint.operationId}</small> : null}
                </td>
                <td>
                  {endpoint.summary}
                  {endpoint.deprecated ? <span className={styles.deprecated}>Deprecated</span> : null}
                </td>
                <td>{endpoint.tags.join(', ') || '—'}</td>
              </tr>
            ))}
            {endpoints.length === 0 ? (
              <tr>
                <td colSpan={4}>No endpoints match this search.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NativeOperations({ capabilities, query }: { capabilities: NativeCapability[]; query: string }) {
  const rows = capabilities.flatMap((capability) =>
    [
      ...capability.readOperations.map((operation) => ({ capability, operation, risk: 'read' })),
      ...capability.manageOperations.map((operation) => ({ capability, operation, risk: 'write' })),
      ...capability.dangerousOperations.map((operation) => ({ capability, operation, risk: 'dangerous' }))
    ].filter(({ capability: app, operation }) =>
      [app.app, operation.name, operation.method, operation.endpoint, operation.description]
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
  );
  return (
    <section className={styles.nativeSection}>
      <div className={styles.sectionIntro}>
        <div>
          <h2>Allowlisted Native Operations</h2>
          <p>These are the exact app operations available through the generic read, manage, and administer actions.</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>No Matching Native Operations</h2>
          <p>
            No enabled installed app exposes an allowlisted operation matching this search. Configure an app or clear
            the search to see available operations.
          </p>
        </div>
      ) : (
        <div className={styles.tableScroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>App</th>
                <th>Operation</th>
                <th>Endpoint</th>
                <th>Access</th>
                <th>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ capability, operation, risk }) => (
                <tr key={`${capability.app}-${risk}-${operation.name}`}>
                  <td>
                    <Link href={`/stack/services?app=${encodeURIComponent(capability.app)}`}>{capability.app}</Link>
                  </td>
                  <td>
                    <code>{operation.name}</code>
                  </td>
                  <td>
                    <span className={`${styles.method} ${styles[operation.method.toLowerCase()]}`}>
                      {operation.method}
                    </span>{' '}
                    <code>{operation.endpoint}</code>
                  </td>
                  <td>
                    <span className={`${styles.risk} ${styles[risk]}`}>{riskLabel(risk)}</span>
                  </td>
                  <td>{operation.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function actionLabel(name: string) {
  return name
    .replace(/^stackarr_/, '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function riskLabel(risk: string) {
  if (risk === 'dangerous') return 'Approval';
  if (risk === 'write') return 'Changes data';
  return 'Read only';
}

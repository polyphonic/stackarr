'use client';

import { Button } from '@stackarr/ui';
import { toast } from '@stackarr/ui/toast';
import { useMemo, useState } from 'react';
import { stackarrFetch } from './clientApi';
import styles from './NativeAppActions.module.css';

type InputKey = 'libraryId' | 'itemId' | 'taskId' | 'sessionId' | 'limit' | 'days' | 'scope';
type Operation = { name: string; description: string; requiresCredential: boolean; requiredInput?: InputKey[] };
type AppCapability = {
  app: string;
  enabled: boolean;
  configured: boolean;
  credentialConfigured: boolean;
  readOperations: Operation[];
  manageOperations: Operation[];
  dangerousOperations: Operation[];
  warning?: string;
};

export type NativeAppCapabilities = { apps: AppCapability[] };
type Kind = 'read' | 'manage' | 'dangerous';

export function NativeAppActions({ capabilities }: { capabilities: NativeAppCapabilities }) {
  const apps = useMemo(
    () => capabilities.apps.filter((app) => app.enabled && totalOperations(app) > 0),
    [capabilities]
  );
  const [selectedApp, setSelectedApp] = useState(apps[0]?.app ?? '');
  const app = apps.find((item) => item.app === selectedApp) ?? apps[0];

  if (!app) {
    return <p className={styles.empty}>Enable an app with native controls to use everyday actions here.</p>;
  }

  const credentialNeeded = [...app.readOperations, ...app.manageOperations, ...app.dangerousOperations].some(
    (operation) => operation.requiresCredential
  );
  const ready = app.configured && (!credentialNeeded || app.credentialConfigured);

  return (
    <div className={styles.shell}>
      <nav className={styles.appRail} aria-label="Apps with native controls">
        {apps.map((item) => (
          <button
            aria-current={item.app === app.app ? 'page' : undefined}
            className={item.app === app.app ? styles.appActive : styles.appButton}
            key={item.app}
            onClick={() => setSelectedApp(item.app)}
            type="button"
          >
            <span>{displayName(item.app)}</span>
            <small>{totalOperations(item)} actions</small>
          </button>
        ))}
      </nav>
      <section className={styles.actions} aria-label={`${displayName(app.app)} native actions`}>
        <header>
          <div>
            <span className={styles.eyebrow}>Native app control</span>
            <h3>{displayName(app.app)}</h3>
          </div>
          <span className={ready ? styles.ready : styles.needsSetup}>{ready ? 'Ready' : 'Partial setup'}</span>
        </header>
        {app.warning && <p className={styles.warning}>{app.warning}</p>}
        {!ready && (
          <p className={styles.warning}>
            Add this app’s URL or agent credential in Settings to unlock protected actions.
          </p>
        )}
        <OperationGroup app={app.app} capability={app} kind="manage" operations={app.manageOperations} />
        <OperationGroup app={app.app} capability={app} kind="read" operations={app.readOperations} />
        <OperationGroup app={app.app} capability={app} kind="dangerous" operations={app.dangerousOperations} />
      </section>
    </div>
  );
}

function OperationGroup({
  app,
  capability,
  kind,
  operations
}: {
  app: string;
  capability: AppCapability;
  kind: Kind;
  operations: Operation[];
}) {
  if (operations.length === 0) return null;
  return (
    <div className={styles.group}>
      <h4>{kind === 'manage' ? 'Everyday actions' : kind === 'read' ? 'Inspect' : 'Changes requiring confirmation'}</h4>
      <div className={styles.operationGrid}>
        {operations.map((operation) => (
          <OperationCard app={app} capability={capability} key={operation.name} kind={kind} operation={operation} />
        ))}
      </div>
    </div>
  );
}

function OperationCard({
  app,
  capability,
  kind,
  operation
}: {
  app: string;
  capability: AppCapability;
  kind: Kind;
  operation: Operation;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({ scope: 'all' });
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<unknown>();
  const required = operation.requiredInput ?? [];
  const configured = capability.configured && (!operation.requiresCredential || capability.credentialConfigured);
  const confirmationReady = inputs.confirmationText === app && Boolean(inputs.reason?.trim());

  async function run() {
    if (kind === 'dangerous' && !confirming) {
      setConfirming(true);
      return;
    }
    setPending(true);
    const toastId = toast.loading(`Running ${humanize(operation.name)}…`);
    try {
      const response = await stackarrFetch('/api/v1/apps/native', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          app,
          kind,
          operation: operation.name,
          ...inputs,
          ...(inputs.limit ? { limit: Number(inputs.limit) } : {}),
          ...(inputs.days ? { days: Number(inputs.days) } : {})
        })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : 'The action failed.');
      setResult(body);
      setConfirming(false);
      toast.success(`${humanize(operation.name)} completed.`, { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The action failed.', { id: toastId });
    } finally {
      setPending(false);
    }
  }

  return (
    <article className={`${styles.operation} ${kind === 'dangerous' ? styles.dangerous : ''}`}>
      <div>
        <strong>{humanize(operation.name)}</strong>
        <p>{operation.description}</p>
      </div>
      {required.map((input) => (
        <label className={styles.field} key={input}>
          <span>{inputLabel(input)}</span>
          {input === 'scope' ? (
            <select
              value={inputs[input] ?? 'all'}
              onChange={(event) => setInputs({ ...inputs, [input]: event.target.value })}
            >
              <option value="all">All configured apps</option>
              <option value="radarr">Radarr</option>
              <option value="sonarr">Sonarr</option>
            </select>
          ) : (
            <input
              inputMode={input === 'limit' || input === 'days' ? 'numeric' : 'text'}
              onChange={(event) => setInputs({ ...inputs, [input]: event.target.value })}
              value={inputs[input] ?? ''}
            />
          )}
        </label>
      ))}
      {confirming && (
        <div className={styles.confirmation}>
          <strong>Confirm this change</strong>
          <label className={styles.field}>
            <span>Why are you running it?</span>
            <input
              onChange={(event) => setInputs({ ...inputs, reason: event.target.value })}
              placeholder="Reason recorded in Activity"
              value={inputs.reason ?? ''}
            />
          </label>
          <label className={styles.field}>
            <span>Type {app}</span>
            <input
              autoComplete="off"
              onChange={(event) => setInputs({ ...inputs, confirmationText: event.target.value })}
              value={inputs.confirmationText ?? ''}
            />
          </label>
        </div>
      )}
      <div className={styles.footer}>
        <Button
          isDisabled={!configured || required.some((input) => !inputs[input]) || (confirming && !confirmationReady)}
          isPending={pending}
          onPress={run}
          size="sm"
          variant={kind === 'dangerous' ? 'secondary' : 'primary'}
        >
          {confirming ? 'Confirm and run' : kind === 'read' ? 'View' : 'Run'}
        </Button>
        {confirming && (
          <Button onPress={() => setConfirming(false)} size="sm" variant="ghost">
            Cancel
          </Button>
        )}
      </div>
      {result !== undefined && (
        <details className={styles.result}>
          <summary>Latest result</summary>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </details>
      )}
    </article>
  );
}

function totalOperations(app: AppCapability) {
  return app.readOperations.length + app.manageOperations.length + app.dangerousOperations.length;
}

function displayName(value: string) {
  const names: Record<string, string> = {
    tinymediamanager: 'tinyMediaManager',
    flaresolverr: 'FlareSolverr',
    romm: 'RomM',
    tidarr: 'Tidarr',
    bookorbit: 'BookOrbit'
  };
  return names[value] ?? `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function inputLabel(value: InputKey) {
  const labels: Record<InputKey, string> = {
    libraryId: 'Library ID',
    itemId: 'Item ID',
    taskId: 'Task ID',
    sessionId: 'Session name',
    limit: 'Result limit',
    days: 'Days',
    scope: 'App scope'
  };
  return labels[value];
}

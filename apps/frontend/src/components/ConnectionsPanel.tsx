'use client';

import type { StackarrConnection, StackarrConnectionSchema } from '@stackarr/core';
import { Label, Switch } from '@stackarr/ui';
import { toast } from '@stackarr/ui/toast';
import { useMemo, useState } from 'react';
import styles from './ConnectionsPanel.module.css';
import { stackarrFetch } from './clientApi';
import { ServiceLogo } from './ServiceLogo';
import { Badge, Panel } from './ui';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type ModalMode = 'add' | 'edit';

export function ConnectionsPanel({
  connections,
  schemas
}: {
  connections: StackarrConnection[];
  schemas: StackarrConnectionSchema[];
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ModalMode>('add');
  const [selectedImplementation, setSelectedImplementation] = useState(schemas[0]?.implementation ?? '');
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const selected = useMemo(
    () => schemas.find((schema) => schema.implementation === selectedImplementation) ?? schemas[0],
    [schemas, selectedImplementation]
  );

  function selectSchema(implementation: string) {
    setSelectedImplementation(implementation);
    setValues({});
    setSaveState('idle');
  }

  function openAddModal() {
    setMode('add');
    selectSchema(schemas[0]?.implementation ?? '');
    setOpen(true);
  }

  function openConnection(connection: StackarrConnection) {
    const schema =
      schemas.find((candidate) => candidate.target === connection.target) ??
      schemas.find((candidate) => candidate.name === connection.name) ??
      schemas[0];

    if (schema) {
      setSelectedImplementation(schema.implementation);
    }

    setMode('edit');
    setValues({ name: connection.name });
    setSaveState('idle');
    setOpen(true);
  }

  async function saveConnection() {
    if (!selected) {
      return;
    }

    setSaveState('saving');
    const toastId = toast.loading('Saving connection...');

    if (selected.implementation === 'Webhook' || selected.implementation === 'CustomScript') {
      const response = await stackarrFetch('/api/v1/notification', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: values.name || selected.name,
          implementation: selected.implementation,
          url: values.url,
          path: values.path,
          events: selected.events ?? ['Test']
        })
      });
      const body = await response.json().catch(() => ({}));

      setSaveState(response.ok ? 'saved' : 'error');
      if (response.ok) {
        toast.success('Connection saved.', { id: toastId });
      } else {
        toast.error(typeof body.message === 'string' ? body.message : 'Connection could not be saved.', {
          id: toastId
        });
      }
      return;
    }

    setSaveState('saved');
    toast.success('Connection settings staged.', { id: toastId });
  }

  return (
    <Panel
      title="Connections"
      action={
        <button className={styles.addButton} onClick={openAddModal} type="button">
          Add Connection
        </button>
      }
    >
      <div className={styles.grid}>
        {connections.map((connection) => (
          <button
            key={connection.name}
            className={styles.card}
            onClick={() => openConnection(connection)}
            type="button"
          >
            <div className={styles.header}>
              <ServiceLogo name={connection.target} size={42} />
              <div>
                <h3>{connection.name}</h3>
                <span>{connection.kind}</span>
              </div>
              <Badge
                tone={
                  connection.status === 'configured' ? 'good' : connection.status === 'needs-setup' ? 'warn' : 'neutral'
                }
              >
                {connection.status}
              </Badge>
            </div>
            <p>{connection.description}</p>
            <div className={styles.fields}>
              {connection.managedFields.map((field) => (
                <Badge key={field} tone="purple">
                  {field}
                </Badge>
              ))}
            </div>
          </button>
        ))}
      </div>

      {open && selected && (
        <div className={styles.modalBackdrop} role="presentation">
          <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="connection-title">
            <div className={styles.modalHeader}>
              <div>
                <h3 id="connection-title">{mode === 'add' ? 'Add Connection' : `Configure ${selected.name}`}</h3>
                <span>Choose an integration type and configure the fields Stackarr manages.</span>
              </div>
              <button className={styles.iconButton} onClick={() => setOpen(false)} type="button" aria-label="Close">
                x
              </button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.schemaList}>
                {schemas.map((schema) => (
                  <button
                    key={schema.implementation}
                    className={`${styles.schemaButton} ${schema.implementation === selected.implementation ? styles.schemaActive : ''}`}
                    onClick={() => selectSchema(schema.implementation)}
                    type="button"
                  >
                    <ServiceLogo name={schema.target} size={32} />
                    <span>{schema.name}</span>
                  </button>
                ))}
              </div>

              <div className={styles.formPane}>
                <div className={styles.formTitle}>
                  <ServiceLogo name={selected.target} size={44} />
                  <div>
                    <h4>{selected.name}</h4>
                    <p>{selected.description}</p>
                  </div>
                  <Badge tone="purple">{selected.kind}</Badge>
                </div>

                <form
                  className={styles.form}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveConnection();
                  }}
                >
                  {selected.fields.map((field) =>
                    field.type === 'checkbox' ? (
                      <Switch
                        key={field.name}
                        className={styles.formSwitch}
                        isSelected={Boolean(values[field.name])}
                        onChange={(value) => setValues((current) => ({ ...current, [field.name]: value }))}
                      >
                        <Switch.Content>
                          <Label>{field.label}</Label>
                          <Switch.Control>
                            <Switch.Thumb />
                          </Switch.Control>
                        </Switch.Content>
                      </Switch>
                    ) : (
                      <label key={field.name}>
                        <span>
                          {field.label}
                          {field.required ? ' *' : ''}
                        </span>
                        {field.type === 'select' ? (
                          <select
                            required={field.required}
                            value={String(values[field.name] ?? field.options?.[0] ?? '')}
                            onChange={(event) =>
                              setValues((current) => ({ ...current, [field.name]: event.target.value }))
                            }
                          >
                            {(field.options ?? []).map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            required={field.required}
                            type={field.type === 'password' ? 'password' : field.type}
                            placeholder={field.placeholder}
                            value={String(values[field.name] ?? '')}
                            onChange={(event) =>
                              setValues((current) => ({ ...current, [field.name]: event.target.value }))
                            }
                          />
                        )}
                      </label>
                    )
                  )}

                  {selected.events && (
                    <div className={styles.events}>
                      {selected.events.map((eventName) => (
                        <Badge key={eventName} tone="neutral">
                          {eventName}
                        </Badge>
                      ))}
                    </div>
                  )}

                  <div className={styles.modalActions}>
                    <button className={styles.secondaryButton} onClick={() => setOpen(false)} type="button">
                      Cancel
                    </button>
                    <button className={styles.addButton} disabled={saveState === 'saving'} type="submit">
                      {saveState === 'saving'
                        ? 'Saving'
                        : saveState === 'saved'
                          ? 'Saved'
                          : mode === 'add'
                            ? 'Add'
                            : 'Save'}
                    </button>
                  </div>
                  {saveState === 'saved' && (
                    <p className={styles.saveNote}>
                      Connection settings are staged for Stackarr-managed configuration. Webhook and custom-script
                      connections are saved immediately.
                    </p>
                  )}
                  {saveState === 'error' && (
                    <p className={styles.errorNote}>
                      Connection could not be saved. Check the API key and required fields.
                    </p>
                  )}
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

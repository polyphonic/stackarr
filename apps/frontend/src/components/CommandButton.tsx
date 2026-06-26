'use client';

import { Button } from '@stackarr/ui';
import { toast } from '@stackarr/ui/toast';
import { useState } from 'react';
import { stackarrFetch } from './clientApi';
import { icons } from './icons';
import styles from './ui.module.css';

export function CommandButton({
  name,
  label,
  disruptive = false
}: {
  name: string;
  label: string;
  disruptive?: boolean;
}) {
  const [state, setState] = useState<'idle' | 'submitting' | 'queued' | 'error'>('idle');
  const normalizedName = name.toLowerCase();
  const CommandIcon =
    state === 'queued'
      ? icons.refresh
      : normalizedName.includes('configure')
        ? icons.wrench
        : normalizedName.includes('start')
          ? icons.play
          : null;
  const variant = normalizedName.includes('start') ? 'primary' : disruptive ? 'secondary' : 'primary';

  async function queueCommand() {
    const confirmed = !disruptive || window.confirm(`${label} can change running services. Continue?`);

    if (!confirmed) {
      return;
    }

    setState('submitting');
    const toastId = toast.loading(`Queueing ${label.toLowerCase()}...`);
    const response = await stackarrFetch('/api/v1/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, confirmed })
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      setState('error');
      toast.error(typeof body.message === 'string' ? body.message : `${label} could not be queued.`, { id: toastId });
      return;
    }

    setState('queued');
    toast.success(`${label} queued.`, { id: toastId });
  }

  return (
    <Button
      className={styles.commandButton}
      isPending={state === 'submitting'}
      onPress={queueCommand}
      size="sm"
      variant={variant}
    >
      {CommandIcon && <CommandIcon size={15} />}
      {state === 'idle' ? label : state === 'submitting' ? 'Queueing' : state === 'queued' ? 'Queued' : 'Failed'}
    </Button>
  );
}

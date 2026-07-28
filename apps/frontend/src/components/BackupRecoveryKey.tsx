'use client';

import type { BackupRecoveryKeyStatus } from '@stackarr/core';
import { Button } from '@stackarr/ui';
import { toast } from '@stackarr/ui/toast';
import { useState } from 'react';
import styles from './BackupRecoveryKey.module.css';
import { stackarrFetch } from './clientApi';
import { Badge, Panel } from './ui';

export function BackupRecoveryKey({ initialStatus }: { initialStatus: BackupRecoveryKeyStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [exporting, setExporting] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');

  async function exportKey() {
    setExporting(true);
    const toastId = toast.loading('Preparing recovery key download...');
    const response = await stackarrFetch('/api/v1/backup/recovery-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message = typeof body.message === 'string' ? body.message : 'The recovery key could not be exported.';
      setExporting(false);
      toast.error(message, { id: toastId });
      return;
    }

    const blob = await response.blob();
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = responseFileName(response.headers.get('content-disposition'));
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);

    const exportedAt = response.headers.get('x-stackarr-key-exported-at') || new Date().toISOString();
    setStatus((current) => ({ ...current, exported: true, exportedAt }));
    setCurrentPassword('');
    setExporting(false);
    toast.success('Recovery key downloaded. Store it separately from the backup archives.', { id: toastId });
  }

  const state = recoveryKeyState(status);

  return (
    <Panel title="Backup Recovery Key" description="Required to decrypt Stackarr's encrypted backup archives">
      <div className={styles.statusLine}>
        <Badge tone={state.tone}>{state.label}</Badge>
        {status.keyId && <code>Key ID {status.keyId}</code>}
        {status.exportedAt && <span>Last exported {new Date(status.exportedAt).toLocaleString()}</span>}
      </div>
      <p className={state.tone === 'good' || state.tone === 'neutral' ? styles.note : styles.warning} role="status">
        {state.message}
      </p>
      {status.encryptionEnabled && status.keyValid && (
        <div className={styles.exportControls}>
          <label>
            <span>Current admin password</span>
            <input
              autoComplete="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <Button isDisabled={!currentPassword} isPending={exporting} onPress={exportKey} size="sm" variant="primary">
            {status.exported ? 'Export again' : 'Export recovery key'}
          </Button>
        </div>
      )}
    </Panel>
  );
}

function recoveryKeyState(status: BackupRecoveryKeyStatus): {
  label: string;
  message: string;
  tone: 'neutral' | 'good' | 'warn' | 'bad';
} {
  if (!status.encryptionEnabled) {
    return {
      label: 'Encryption disabled',
      message: 'No recovery key is used. Protect the entire backup destination with trusted external encryption.',
      tone: 'neutral'
    };
  }
  if (!status.keyAvailable) {
    return {
      label: 'Not generated',
      message:
        'Run an encrypted backup to generate the key, then export it. Until a separate copy is stored, a complete restore of settings and credentials is not possible.',
      tone: 'warn'
    };
  }
  if (!status.keyValid) {
    return {
      label: 'Invalid key',
      message: 'The recovery key file is invalid. New encrypted backups and complete restores are at risk.',
      tone: 'bad'
    };
  }
  if (!status.exported) {
    return {
      label: 'Export required',
      message:
        'Download this key and store it separately from your backups. Without it, encrypted archives cannot be fully restored and settings and credentials must be entered again.',
      tone: 'warn'
    };
  }

  return {
    label: 'Exported',
    message: 'A copy of this exact key has been downloaded. Keep it in a password manager or another secure location.',
    tone: 'good'
  };
}

function responseFileName(disposition: string | null) {
  const match = disposition?.match(/filename="?([^";]+)"?/i);
  return match?.[1] || 'stackarr-backup-recovery-key.txt';
}

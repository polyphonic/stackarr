'use client';

import { useState } from 'react';
import styles from './PortlessHostCommands.module.css';

const commands = [
  { label: 'Check status', command: 'stackarr portless status' },
  { label: 'Refresh aliases', command: 'stackarr portless apply' },
  { label: 'Install agent', command: 'stackarr portless install' },
  { label: 'Uninstall agent', command: 'stackarr portless uninstall' }
] as const;

export function PortlessHostCommands() {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(command: string) {
    await navigator.clipboard.writeText(command);
    setCopied(command);
    window.setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div className={styles.wrapper}>
      <p className={styles.notice}>
        Portless changes certificate trust, privileged ports, and host aliases. Run these commands in a trusted terminal
        on the Docker host; the dashboard container cannot request macOS approval.
      </p>
      <div className={styles.commands}>
        {commands.map((item) => (
          <div className={styles.command} key={item.command}>
            <div>
              <strong>{item.label}</strong>
              <code>{item.command}</code>
            </div>
            <button type="button" onClick={() => copy(item.command)}>
              {copied === item.command ? 'Copied' : 'Copy'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

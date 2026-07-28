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
      <p className={styles.guidance}>
        Portless is managed by the Docker host. Copy the command you need and run it in a trusted host terminal.
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

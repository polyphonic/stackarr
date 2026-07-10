'use client';

import type { McpClientId, McpConnectionKit, McpProfile } from '@stackarr/core';
import { useMemo, useState } from 'react';
import styles from './AgentConnectionKit.module.css';

const profileLabels: Record<McpProfile, string> = {
  observe: 'Observe · read only',
  manage: 'Manage · everyday actions',
  admin: 'Admin · setup and recovery',
  unrestricted: 'Unrestricted · full autonomy'
};

export function AgentConnectionKit({
  kitsByProfile,
  initialProfile
}: {
  kitsByProfile: Record<McpProfile, McpConnectionKit[]>;
  initialProfile: McpProfile;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [client, setClient] = useState<McpClientId>('codex');
  const [copied, setCopied] = useState<'command' | 'config' | null>(null);
  const kits = kitsByProfile[profile];
  const kit = useMemo(() => kits.find((candidate) => candidate.client === client) ?? kits[0]!, [client, kits]);

  async function copy(kind: 'command' | 'config', value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1600);
  }

  const configText = kit.config ? JSON.stringify(kit.config, null, 2) : '';

  return (
    <div className={styles.workspace}>
      <div className={styles.controls}>
        <div>
          <span className={styles.eyebrow}>1 · Choose where you chat</span>
          <div className={styles.clientGrid} role="list" aria-label="MCP clients">
            {kits.map((candidate) => (
              <button
                key={candidate.client}
                type="button"
                className={candidate.client === client ? styles.clientActive : styles.client}
                aria-pressed={candidate.client === client}
                onClick={() => {
                  setClient(candidate.client);
                  setCopied(null);
                }}
              >
                <span>{candidate.label}</span>
                <small>{candidate.transport === 'openai-secure-tunnel' ? 'Private tunnel' : 'Docker host'}</small>
              </button>
            ))}
          </div>
        </div>

        <label className={styles.profileControl}>
          <span className={styles.eyebrow}>2 · Choose authority</span>
          <select
            value={profile}
            onChange={(event) => {
              setProfile(event.target.value as McpProfile);
              setCopied(null);
            }}
          >
            {Object.entries(profileLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <small>{kit.profileDescription}</small>
        </label>
      </div>

      <section className={styles.kit} aria-live="polite">
        <div className={styles.kitHeader}>
          <div>
            <span className={styles.eyebrow}>Your connection kit</span>
            <h2>{kit.label}</h2>
            <p>{kit.summary}</p>
          </div>
          <div className={styles.tags}>
            <span>{kit.transport === 'openai-secure-tunnel' ? 'Outbound-only tunnel' : 'Local stdio'}</span>
            <span>{kit.groups === 'all-relevant' ? 'Automatic app filtering' : `${kit.groups.length} groups`}</span>
          </div>
        </div>

        <ol className={styles.steps}>
          {kit.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>

        {kit.command && (
          <CodeBlock
            label={kit.client === 'chatgpt' ? 'Run on the Docker host' : 'Install command'}
            value={kit.command}
            copied={copied === 'command'}
            onCopy={() => copy('command', kit.command || '')}
          />
        )}
        {configText && (
          <CodeBlock
            label="MCP configuration"
            value={configText}
            copied={copied === 'config'}
            onCopy={() => copy('config', configText)}
          />
        )}

        {kit.warnings.length > 0 && (
          <div className={profile === 'unrestricted' ? styles.danger : styles.notice}>
            <strong>{profile === 'unrestricted' ? 'Full control enabled' : 'Before you connect'}</strong>
            <ul>
              {kit.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        <div className={styles.firstPrompt}>
          <span className={styles.eyebrow}>First message</span>
          <p>“{kit.verificationPrompt}”</p>
        </div>
      </section>
    </div>
  );
}

function CodeBlock({
  label,
  value,
  copied,
  onCopy
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className={styles.codeGroup}>
      <div className={styles.codeHeader}>
        <span>{label}</span>
        <button type="button" onClick={onCopy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{value}</pre>
    </div>
  );
}

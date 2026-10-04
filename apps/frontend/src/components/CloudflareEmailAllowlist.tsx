'use client';

import { Button, Chip, CloseButton } from '@stackarr/ui';
import { toast } from '@stackarr/ui/toast';
import { useState } from 'react';
import styles from './CloudflareEmailAllowlist.module.css';
import { stackarrFetch } from './clientApi';

type Props = {
  initialEmails: string;
  onPublished: (emails: string[]) => void;
};

type PublishResponse = {
  allowedEmails?: string[];
  error?: string;
};

export function CloudflareEmailAllowlist({ initialEmails, onPublished }: Props) {
  const [emails, setEmails] = useState(() => normalizeEmails(initialEmails));
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');

  async function addInputEmails() {
    const entries = splitEmails(input);
    if (entries.some((email) => !isEmail(email))) {
      setMessage('Enter valid email addresses separated by commas.');
      return;
    }
    const additions = normalizeEmails(input);
    if (additions.length === 0) {
      setMessage(input.trim() ? 'Enter a valid email address.' : 'Enter an email address.');
      return;
    }

    const next = [...new Set([...emails, ...additions])];
    if (next.length === emails.length) {
      setInput('');
      setMessage('That email is already allowed.');
      return;
    }
    await publish(next, emails, 'Adding email to Cloudflare Access...');
  }

  async function removeEmail(email: string) {
    const next = emails.filter((candidate) => candidate !== email);
    if (next.length === 0) {
      setMessage('Keep at least one allowed email while Access protection is enabled.');
      return;
    }
    await publish(next, emails, 'Removing email from Cloudflare Access...');
  }

  async function publish(next: string[], previous: string[], loadingMessage: string) {
    setPending(true);
    setMessage('Publishing to Cloudflare...');
    setEmails(next);
    const toastId = toast.loading(loadingMessage);

    try {
      const response = await stackarrFetch('/api/v1/cloudflare/access', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ allowedEmails: next })
      });
      const body = (await response.json().catch(() => ({}))) as PublishResponse;
      if (!response.ok || !body.allowedEmails) {
        throw new Error(body.error || 'Cloudflare email allowlist publish failed.');
      }

      setEmails(body.allowedEmails);
      setInput('');
      setMessage('Published to Cloudflare.');
      onPublished(body.allowedEmails);
      toast.success('Cloudflare email allowlist updated.', { id: toastId });
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Cloudflare email allowlist publish failed.';
      setEmails(previous);
      setMessage(detail);
      toast.error(detail, { id: toastId });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.editor}>
      <span className={styles.label}>Allowed emails</span>
      <div className={styles.control}>
        <div className={styles.chips} aria-label="Cloudflare Access allowed emails">
          {emails.map((email) => (
            <Chip key={email} size="sm" variant="secondary">
              <Chip.Label>{email}</Chip.Label>
              <CloseButton
                aria-label={`Remove ${email}`}
                isDisabled={pending}
                onPress={() => void removeEmail(email)}
              />
            </Chip>
          ))}
        </div>
        <div className={styles.addRow}>
          <input
            aria-label="Add allowed email"
            disabled={pending}
            inputMode="email"
            onChange={(event) => {
              setInput(event.target.value);
              setMessage('');
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              void addInputEmails();
            }}
            placeholder="name@example.com"
            type="text"
            value={input}
          />
          <Button isDisabled={pending} onPress={() => void addInputEmails()} size="sm" variant="secondary">
            {pending ? 'Publishing...' : 'Add email'}
          </Button>
        </div>
        <small className={message.includes('Published') ? styles.success : undefined} aria-live="polite">
          {message || 'Press Enter to add and publish. Paste multiple addresses separated by commas.'}
        </small>
      </div>
    </div>
  );
}

function normalizeEmails(value: string) {
  return [...new Set(splitEmails(value).filter(isEmail))];
}

function splitEmails(value: string) {
  return value
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

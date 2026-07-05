'use client';

import { Button } from '@stackarr/ui';
import { toast } from '@stackarr/ui/toast';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import styles from './LoginForm.module.css';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError('');

    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const body = await response.json().catch(() => ({}));

    setSubmitting(false);

    if (!response.ok) {
      const message = typeof body.message === 'string' ? body.message : 'Sign in failed.';
      setError(message);
      toast.error(message);
      return;
    }

    toast.success('Signed in.');
    const next = searchParams.get('next') || '/';
    router.replace(next.startsWith('/') ? next : '/');
    router.refresh();
  }

  return (
    <div className={styles.shell}>
      <section className={styles.panel}>
        <div className={styles.header}>
          <h1>Sign In</h1>
          <p>Use the shared Stackarr service credentials.</p>
        </div>
        <form className={styles.form} onSubmit={submit}>
          <label className={styles.field}>
            <span>Username or Email</span>
            <input
              autoComplete="username"
              autoFocus
              name="username"
              onChange={(event) => setUsername(event.target.value)}
              value={username}
            />
          </label>
          <label className={styles.field}>
            <span>Password</span>
            <input
              autoComplete="current-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <Button isPending={submitting} type="submit" variant="primary">
            Sign In
          </Button>
        </form>
      </section>
    </div>
  );
}

import { readEnv, readSettings } from '@stackarr/core';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { stackarrSessionCookie, validStackarrSessionToken } from './api';

export async function requireDashboardAuth(nextPath: string, options: { allowUnconfigured?: boolean } = {}) {
  const env = readEnv();

  if (options.allowUnconfigured && !env.STACKARR_API_KEY?.trim() && !env.PASSWORD?.trim()) {
    return;
  }

  const settings = readSettings();

  if (settings.host.authenticationMethod === 'none') {
    return;
  }

  const token = (await cookies()).get(stackarrSessionCookie())?.value;

  if (validStackarrSessionToken(token, env)) {
    return;
  }

  redirect(`/login?next=${encodeURIComponent(safeNextPath(nextPath))}`);
}

function safeNextPath(nextPath: string) {
  if (!nextPath.startsWith('/') || nextPath.startsWith('//') || nextPath.includes('\\')) {
    return '/';
  }

  return nextPath;
}

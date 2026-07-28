import type { StackarrSettings } from '@stackarr/core';

export type PortlessHostAction = {
  command: 'stackarr portless apply' | 'stackarr portless install';
  status: 'host-required';
};

/**
 * Describe the host command needed after a settings change.
 *
 * Portless changes host certificate trust, privileged ports, and /etc/hosts. The
 * dashboard runs inside Docker, so queuing this as a container task can never
 * succeed and incorrectly records an expected host handoff as a blocked task.
 */
export function portlessHostActionIfNeeded(
  before: StackarrSettings,
  after: StackarrSettings,
  options?: {
    force?: boolean;
  }
) {
  const force = options?.force === true;
  const portlessWasEnabled = before.ui.serviceUrlMode === 'portless';
  const portlessIsEnabled = after.ui.serviceUrlMode === 'portless';
  const portlessSettingsChanged =
    before.ui.serviceUrlScheme !== after.ui.serviceUrlScheme ||
    before.ui.serviceUrlHostSuffix !== after.ui.serviceUrlHostSuffix;

  if (!portlessIsEnabled || (!force && portlessWasEnabled && !portlessSettingsChanged)) {
    return null;
  }

  return {
    command: portlessWasEnabled ? 'stackarr portless apply' : 'stackarr portless install',
    status: 'host-required'
  } satisfies PortlessHostAction;
}

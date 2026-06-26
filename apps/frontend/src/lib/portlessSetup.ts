import { createQueuedTask, getCommand, type StackarrSettings } from '@stackarr/core';
import { runQueuedTask } from './runner';

export function queuePortlessSetupIfNeeded(
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

  const command = getCommand('PortlessInstall');

  if (!command) {
    return null;
  }

  const task = createQueuedTask(command.name, command.label);
  return runQueuedTask(task, command);
}

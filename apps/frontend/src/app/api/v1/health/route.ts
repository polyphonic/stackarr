import { getSystemStatus } from '@stackarr/core';
import { json } from '../../../../lib/api';

export async function GET() {
  const status = getSystemStatus();
  const issues = [];

  if (!status.configured) {
    issues.push({
      source: 'Config',
      type: 'error',
      message: 'Stackarr config is missing. Run the setup wizard or stackarr init.'
    });
  }

  if (!status.composeFilePresent) {
    issues.push({
      source: 'Compose',
      type: 'error',
      message: 'stackarr/docker-compose.yml is missing.'
    });
  }

  return json(issues);
}

import { getServices, getSystemStatus } from '@stackarr/core';
import { json } from '../../../../../lib/api';

export async function GET() {
  return json({
    ...getSystemStatus(),
    services: getServices()
  });
}

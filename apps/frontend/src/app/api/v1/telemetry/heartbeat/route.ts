import { maybeSendTelemetryHeartbeatAction } from '@stackarr/core';
import { json } from '../../../../../lib/api';

export async function POST() {
  return json(await maybeSendTelemetryHeartbeatAction());
}

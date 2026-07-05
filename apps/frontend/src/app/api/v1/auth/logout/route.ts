import { json, clearStackarrSessionCookie } from '../../../../../lib/api';

export async function POST() {
  return clearStackarrSessionCookie(json({ authenticated: false }));
}

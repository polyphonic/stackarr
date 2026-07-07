import { redirect } from 'next/navigation';
import { requireDashboardAuth } from '../../lib/serverAuth';

export default async function SystemPage() {
  await requireDashboardAuth('/system');

  redirect('/system/status');
}

import { redirect } from 'next/navigation';
import { requireDashboardAuth } from '../../../lib/serverAuth';

export default async function MediaServersPage() {
  await requireDashboardAuth('/stack/media-servers');
  redirect('/stack/services');
}

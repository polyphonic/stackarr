import { SubNav } from './SubNav';

const activityItems = [
  { href: '/activity/queue', label: 'Active work' },
  { href: '/activity/history', label: 'Action history' },
  { href: '/system/logs', label: 'Server logs' }
];

export function ActivityNav() {
  return <SubNav items={activityItems} />;
}

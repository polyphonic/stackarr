import { SubNav } from './SubNav';

const activityItems = [
  { href: '/activity/queue', label: 'Active Work' },
  { href: '/activity/history', label: 'Action History' },
  { href: '/activity/agents', label: 'Agent Activity' },
  { href: '/system/logs', label: 'Server Logs' }
];

export function ActivityNav() {
  return <SubNav items={activityItems} />;
}

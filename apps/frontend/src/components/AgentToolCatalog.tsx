import type { ToolCatalogEntry } from '@stackarr/core';
import { Badge, Panel, Table } from './ui';

function tone(risk: ToolCatalogEntry['risk']) {
  if (risk === 'dangerous') return 'bad' as const;
  if (risk === 'write') return 'warn' as const;
  return 'good' as const;
}

function riskLabel(risk: ToolCatalogEntry['risk']) {
  if (risk === 'dangerous') return 'Approval required';
  if (risk === 'write') return 'Makes changes';
  return 'Read only';
}

function categoryLabel(category: string) {
  const labels: Record<string, string> = {
    stack: 'Stackarr',
    services: 'Services',
    containers: 'Containers',
    arr: 'Movies & TV',
    releases: 'Search & indexers',
    downloads: 'Downloads',
    plex: 'Plex',
    seerr: 'Requests',
    backups: 'Backups',
    health: 'Health & repair'
  };
  return labels[category] ?? category;
}

function actionLabel(name: string) {
  return name
    .replace(/^stackarr_/, '')
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function AgentToolCatalog({ tools }: { tools: ToolCatalogEntry[] }) {
  const grouped = tools.reduce<Record<string, ToolCatalogEntry[]>>((acc, tool) => {
    acc[tool.category] ??= [];
    acc[tool.category].push(tool);
    return acc;
  }, {});
  return (
    <>
      {Object.entries(grouped).map(([category, items]) => (
        <Panel key={category} title={categoryLabel(category)}>
          <Table>
            <thead>
              <tr>
                <th>Action</th>
                <th>Access</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              {items.map((tool) => (
                <tr key={tool.name}>
                  <td>
                    <strong>{actionLabel(tool.name)}</strong>
                    <br />
                    <code>{tool.name}</code>
                  </td>
                  <td>
                    <Badge tone={tone(tool.risk)}>{riskLabel(tool.risk)}</Badge>
                  </td>
                  <td>{tool.description}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Panel>
      ))}
    </>
  );
}

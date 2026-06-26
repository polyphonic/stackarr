import type { ToolCatalogEntry } from '@stackarr/core';
import { Badge, Panel, Table } from './ui';

function tone(risk: ToolCatalogEntry['risk']) {
  if (risk === 'dangerous') return 'bad' as const;
  if (risk === 'write') return 'warn' as const;
  return 'good' as const;
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
        <Panel key={category} title={`${category} tools`}>
          <Table>
            <thead>
              <tr>
                <th>Tool</th>
                <th>Risk</th>
                <th>Scopes</th>
                <th>Remote default</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {items.map((tool) => (
                <tr key={tool.name}>
                  <td>
                    <code>{tool.name}</code>
                  </td>
                  <td>
                    <Badge tone={tone(tool.risk)}>{tool.risk}</Badge>
                  </td>
                  <td>
                    {tool.scopes.map((scope) => (
                      <Badge key={scope} tone="purple">
                        {scope}
                      </Badge>
                    ))}
                  </td>
                  <td>
                    {tool.remoteReadyDefault ? (
                      <Badge tone="good">yes</Badge>
                    ) : (
                      <Badge tone="neutral">local only</Badge>
                    )}
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

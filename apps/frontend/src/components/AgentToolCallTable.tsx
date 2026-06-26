import type { AgentActivityRecord } from '@stackarr/core';
import { Badge, Panel, Table } from './ui';

function statusTone(status: AgentActivityRecord['status']) {
  if (status === 'success') return 'good' as const;
  if (status === 'error' || status === 'denied') return 'bad' as const;
  return 'warn' as const;
}

function compact(value: unknown) {
  if (value === undefined) return '—';
  const text = JSON.stringify(value);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

export function AgentToolCallTable({ records }: { records: AgentActivityRecord[] }) {
  return (
    <Panel title="Agent activity">
      <Table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Caller</th>
            <th>Tool</th>
            <th>Risk</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>{new Date(record.timestamp).toLocaleString()}</td>
              <td>{record.caller}</td>
              <td>
                <code>{record.toolName}</code>
              </td>
              <td>
                <Badge tone={record.risk === 'dangerous' ? 'bad' : record.risk === 'write' ? 'warn' : 'good'}>
                  {record.risk}
                </Badge>
              </td>
              <td>
                <Badge tone={statusTone(record.status)}>{record.status}</Badge>
              </td>
              <td>{record.durationMs ? `${record.durationMs} ms` : '—'}</td>
              <td>
                <details>
                  <summary>{record.error ?? compact(record.resultSummary)}</summary>
                  <pre>{JSON.stringify(record, null, 2)}</pre>
                </details>
              </td>
            </tr>
          ))}
          {records.length === 0 ? (
            <tr>
              <td colSpan={7}>No agent activity recorded yet.</td>
            </tr>
          ) : null}
        </tbody>
      </Table>
    </Panel>
  );
}

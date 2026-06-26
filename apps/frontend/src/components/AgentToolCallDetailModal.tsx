import type { AgentActivityRecord } from '@stackarr/core';

export function AgentToolCallDetailModal({ record }: { record?: AgentActivityRecord }) {
  if (!record) return null;
  return <pre>{JSON.stringify(record, null, 2)}</pre>;
}

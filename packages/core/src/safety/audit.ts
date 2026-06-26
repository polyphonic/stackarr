import type { AgentActivityRecord } from '../actions/agentActivity';
import { appendAgentActivityRecord, updateAgentActivityRecord } from '../actions/agentActivity';
import type { RiskLevel, StackarrScope } from './scopes';

export type AuditStartInput = {
  caller: AgentActivityRecord['caller'];
  toolName: string;
  category: string;
  scopes: StackarrScope[];
  risk: RiskLevel;
  inputSummary?: unknown;
};

export async function auditStarted(input: AuditStartInput) {
  const record = await appendAgentActivityRecord({
    ...input,
    status: 'started'
  });
  return record;
}

export async function auditFinished(
  id: string,
  patch: Pick<AgentActivityRecord, 'status' | 'durationMs' | 'resultSummary' | 'error'>
) {
  await updateAgentActivityRecord(id, patch);
}

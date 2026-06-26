import { randomUUID } from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { insertAgentActivityRow, readAgentActivityRows, updateAgentActivityRow } from '../database';
import { stateRoot } from '../paths';
import { redactSecrets } from '../safety/redaction';
import type { RiskLevel, StackarrScope } from '../safety/scopes';

export type AgentActivityRecord = {
  id: string;
  timestamp: string;
  caller: 'mcp-local' | 'dashboard' | 'future-remote';
  toolName: string;
  category: string;
  scopes: StackarrScope[];
  risk: RiskLevel;
  inputSummary?: unknown;
  status: 'started' | 'success' | 'error' | 'denied';
  durationMs?: number;
  resultSummary?: unknown;
  error?: string;
};

export const agentActivityPath = path.join(stateRoot, 'agent-activity.jsonl');
let migratedAgentActivityFile = false;

export async function appendAgentActivityRecord(
  input: Omit<AgentActivityRecord, 'id' | 'timestamp'> & Partial<Pick<AgentActivityRecord, 'id' | 'timestamp'>>
) {
  await fs.mkdir(path.dirname(agentActivityPath), { recursive: true });
  const record: AgentActivityRecord = redactSecrets({
    id: input.id ?? randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    ...input
  });
  await migrateAgentActivityFileToDatabase();
  if (insertAgentActivityRow(record)) {
    return record;
  }

  await fs.appendFile(agentActivityPath, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}

export async function listAgentActivityRecords(limit = 100): Promise<AgentActivityRecord[]> {
  await migrateAgentActivityFileToDatabase();
  const records = readAgentActivityRows(limit);
  if (records) {
    return records;
  }

  return readAgentActivityFile(limit);
}

export async function getAgentActivityRecord(id: string) {
  const records = await listAgentActivityRecords(1000);
  return records.find((record) => record.id === id);
}

export async function updateAgentActivityRecord(id: string, patch: Partial<AgentActivityRecord>) {
  await migrateAgentActivityFileToDatabase();
  if (updateAgentActivityRow(id, redactSecrets(patch))) {
    return;
  }

  if (!fsSync.existsSync(agentActivityPath)) {
    return;
  }
  const raw = await fs.readFile(agentActivityPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const updated = lines.map((line) => {
    const record = JSON.parse(line) as AgentActivityRecord;
    return JSON.stringify(record.id === id ? redactSecrets({ ...record, ...patch }) : record);
  });
  await fs.writeFile(agentActivityPath, `${updated.join('\n')}\n`, 'utf8');
}

async function migrateAgentActivityFileToDatabase() {
  if (migratedAgentActivityFile) {
    return;
  }
  migratedAgentActivityFile = true;

  if (!fsSync.existsSync(agentActivityPath)) {
    return;
  }

  const existing = readAgentActivityRows(1);
  if (existing === undefined || existing.length > 0) {
    return;
  }

  const records = await readAgentActivityFile(1000);
  for (const record of records.reverse()) {
    insertAgentActivityRow(record);
  }
}

async function readAgentActivityFile(limit: number) {
  if (!fsSync.existsSync(agentActivityPath)) {
    return [];
  }
  const raw = await fs.readFile(agentActivityPath, 'utf8');
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as AgentActivityRecord)
    .slice(-limit)
    .reverse();
}

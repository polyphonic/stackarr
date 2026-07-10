import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readJsonSetting, writeJsonSetting } from '../database';
import type { McpProfile, ToolCategory } from './types';

export type McpConnectionPolicy = {
  id: string;
  name: string;
  profile: McpProfile;
  groups?: ToolCategory[];
  enabled: boolean;
  tokenPrefix: string;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
};

export type McpConnectionPolicySummary = Omit<McpConnectionPolicy, 'tokenHash'>;

const policiesKey = 'stackarr.mcpConnectionPolicies';
const profileRank: Record<McpProfile, number> = { observe: 0, manage: 1, admin: 2, unrestricted: 3 };

export function listMcpConnectionPoliciesAction() {
  return { policies: readPolicies().map(summarizePolicy), tokensRecoverable: false };
}

export function createMcpConnectionPolicyAction(input: {
  name: string;
  profile: McpProfile;
  groups?: ToolCategory[];
  callerProfile: McpProfile;
}) {
  assertCanGrant(input.callerProfile, input.profile);
  validatePolicyName(input.name);
  const token = newPolicyToken();
  const now = new Date().toISOString();
  const policy: McpConnectionPolicy = {
    id: randomUUID(),
    name: input.name.trim(),
    profile: input.profile,
    ...(input.groups?.length ? { groups: [...new Set(input.groups)] } : {}),
    enabled: true,
    tokenPrefix: token.slice(0, 16),
    tokenHash: hashToken(token),
    createdAt: now,
    updatedAt: now
  };
  writePolicies([...readPolicies(), policy]);
  return {
    created: true,
    policy: summarizePolicy(policy),
    token,
    note: 'Copy this token now. Stackarr stores only its hash and cannot show it again.'
  };
}

export function updateMcpConnectionPolicyAction(input: {
  id: string;
  name?: string;
  profile?: McpProfile;
  groups?: ToolCategory[];
  enabled?: boolean;
  callerProfile: McpProfile;
}) {
  const policies = readPolicies();
  const existing = policies.find((policy) => policy.id === input.id);
  if (!existing) throw new Error(`Connection policy ${input.id} was not found.`);
  const profile = input.profile ?? existing.profile;
  assertCanGrant(input.callerProfile, profile);
  if (input.name !== undefined) validatePolicyName(input.name);
  const updated: McpConnectionPolicy = {
    ...existing,
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    profile,
    ...(input.groups !== undefined
      ? input.groups.length
        ? { groups: [...new Set(input.groups)] }
        : { groups: undefined }
      : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    updatedAt: new Date().toISOString()
  };
  writePolicies(policies.map((policy) => (policy.id === input.id ? updated : policy)));
  return { updated: true, policy: summarizePolicy(updated) };
}

export function revokeMcpConnectionPolicyAction(input: { id: string }) {
  return updateMcpConnectionPolicyAction({ id: input.id, enabled: false, callerProfile: 'unrestricted' });
}

export function rotateMcpConnectionPolicyTokenAction(input: { id: string; callerProfile: McpProfile }) {
  const policies = readPolicies();
  const existing = policies.find((policy) => policy.id === input.id);
  if (!existing) throw new Error(`Connection policy ${input.id} was not found.`);
  assertCanGrant(input.callerProfile, existing.profile);
  const token = newPolicyToken();
  const updated: McpConnectionPolicy = {
    ...existing,
    tokenPrefix: token.slice(0, 16),
    tokenHash: hashToken(token),
    enabled: true,
    updatedAt: new Date().toISOString()
  };
  writePolicies(policies.map((policy) => (policy.id === input.id ? updated : policy)));
  return {
    rotated: true,
    policy: summarizePolicy(updated),
    token,
    note: 'The previous token is revoked. Copy this replacement now; it cannot be recovered.'
  };
}

export function authenticateMcpConnectionToken(token: string | undefined): McpConnectionPolicySummary | undefined {
  if (!token?.startsWith('stk_mcp_')) return undefined;
  const candidate = hashToken(token);
  const policies = readPolicies();
  const match = policies.find((policy) => policy.enabled && secretEqual(policy.tokenHash, candidate));
  if (!match) return undefined;
  const updated = { ...match, lastUsedAt: new Date().toISOString() };
  writePolicies(policies.map((policy) => (policy.id === match.id ? updated : policy)));
  return summarizePolicy(updated);
}

function readPolicies() {
  const policies = readJsonSetting<McpConnectionPolicy[]>(policiesKey, []);
  return Array.isArray(policies) ? policies : [];
}

function writePolicies(policies: McpConnectionPolicy[]) {
  writeJsonSetting(policiesKey, policies);
}

function summarizePolicy(policy: McpConnectionPolicy): McpConnectionPolicySummary {
  const { tokenHash: _, ...summary } = policy;
  return summary;
}

function assertCanGrant(callerProfile: McpProfile, requestedProfile: McpProfile) {
  if (callerProfile !== 'admin' && callerProfile !== 'unrestricted') {
    throw new Error('Connection policies can only be managed from an admin or unrestricted control plane.');
  }
  if (profileRank[requestedProfile] > profileRank[callerProfile]) {
    throw new Error(`${callerProfile} cannot create or update a ${requestedProfile} connection.`);
  }
}

function validatePolicyName(name: string) {
  if (!name.trim() || name.trim().length > 80) throw new Error('Policy name must be 1 to 80 characters.');
}

function newPolicyToken() {
  return `stk_mcp_${randomBytes(32).toString('base64url')}`;
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function secretEqual(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

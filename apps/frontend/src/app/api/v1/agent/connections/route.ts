import {
  getMcpConnectionKit,
  getMcpConnectionKits,
  isMcpClientId,
  type McpProfile,
  resolveMcpGroups,
  resolveMcpProfile
} from '@stackarr/core';
import type { NextRequest } from 'next/server';
import { json, requireApiKey } from '../../../../../lib/api';

const profiles = new Set<McpProfile>(['observe', 'manage', 'admin', 'unrestricted']);

export async function GET(request: NextRequest) {
  const auth = requireApiKey(request);
  if (auth) return auth;

  const requestedClient = request.nextUrl.searchParams.get('client')?.trim().toLowerCase();
  const requestedProfile = request.nextUrl.searchParams.get('profile')?.trim().toLowerCase();
  const requestedGroups = request.nextUrl.searchParams.get('groups')?.trim();
  const containerName = request.nextUrl.searchParams.get('containerName')?.trim();
  const tunnelId = request.nextUrl.searchParams.get('tunnelId')?.trim();

  if (requestedClient && !isMcpClientId(requestedClient)) {
    return json({ message: `Unknown MCP client: ${requestedClient}` }, { status: 400 });
  }
  if (requestedProfile && !profiles.has(requestedProfile as McpProfile)) {
    return json({ message: `Unknown MCP profile: ${requestedProfile}` }, { status: 400 });
  }

  const client = requestedClient && isMcpClientId(requestedClient) ? requestedClient : undefined;
  const profile = requestedProfile ? (requestedProfile as McpProfile) : resolveMcpProfile();
  const groups = requestedGroups ? resolveMcpGroups(requestedGroups) : undefined;
  const options = { profile, groups, containerName, tunnelId };

  return json({
    profile,
    kits: client ? [getMcpConnectionKit({ ...options, client })] : getMcpConnectionKits(options)
  });
}

import { readEnv } from '@stackarr/core';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const env = readEnv();
  if (env.STACKARR_MCP_HTTP_ENABLED?.trim().toLowerCase() !== 'true') {
    return Response.json({ message: 'Remote MCP is disabled.' }, { status: 404 });
  }

  const port = Number(process.env.STACKARR_MCP_HTTP_PORT || 7780);
  const headers = new Headers();
  for (const name of ['authorization', 'content-type', 'accept', 'mcp-protocol-version', 'origin']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers,
      body: await request.arrayBuffer(),
      signal: AbortSignal.timeout(35_000)
    });
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch {
    return Response.json({ message: 'The authenticated MCP service is not running.' }, { status: 503 });
  }
}

export function GET() {
  return Response.json({ message: 'Use POST for the stateless MCP endpoint.' }, { status: 405 });
}

export const DELETE = GET;

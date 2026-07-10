import { createServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { authenticateMcpConnectionToken, readEnv } from '@stackarr/core';
import { createStackarrMcpServer } from './server';

export async function startStackarrMcpHttpServer() {
  const host = process.env.STACKARR_MCP_HTTP_LISTEN_HOST?.trim() || '127.0.0.1';
  const port = boundedPort(process.env.STACKARR_MCP_HTTP_PORT, 7780);
  const allowedHosts = list(
    process.env.STACKARR_MCP_HTTP_ALLOWED_HOSTS ||
      `localhost,localhost:${port},127.0.0.1,127.0.0.1:${port},stackarr,stackarr:${port}`
  );
  const httpServer = createServer(async (request, response) => {
    if (request.url?.split('?')[0] !== '/mcp') return jsonError(response, 404, 'Not found.');
    if (readEnv().STACKARR_MCP_HTTP_ENABLED?.trim().toLowerCase() !== 'true') {
      return jsonError(response, 404, 'Remote MCP is disabled.');
    }
    if (request.method !== 'POST')
      return jsonError(response, 405, 'Only POST is supported by this stateless endpoint.');
    if (!originAllowed(request.headers.origin, list(readEnv().STACKARR_MCP_HTTP_ALLOWED_ORIGINS)))
      return jsonError(response, 403, 'Origin is not allowed.');
    const contentLength = Number(request.headers['content-length'] ?? 0);
    if (contentLength > 1_048_576) return jsonError(response, 413, 'MCP request exceeds the 1 MB limit.');

    const token = bearerToken(request.headers.authorization);
    const policy = authenticateMcpConnectionToken(token);
    if (!policy) {
      response.setHeader('www-authenticate', 'Bearer realm="stackarr-mcp"');
      return jsonError(response, 401, 'A valid Stackarr MCP connection token is required.');
    }

    const server = createStackarrMcpServer({
      profile: policy.profile,
      groups: policy.groups,
      caller: `mcp-remote:${policy.id}`
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      allowedHosts,
      enableDnsRebindingProtection: true
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response);
      response.once('finish', () => {
        setImmediate(() => {
          void transport.close();
          void server.close();
        });
      });
    } catch {
      if (!response.headersSent) jsonError(response, 500, 'Internal MCP transport error.');
    }
  });

  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, resolve);
  });
  process.stderr.write(`Stackarr authenticated MCP listening on http://${host}:${port}/mcp\n`);
  return httpServer;
}

function bearerToken(header: string | undefined) {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function list(value: string | undefined) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function originAllowed(origin: string | undefined, allowedOrigins: string[]) {
  if (!origin) return true;
  return allowedOrigins.includes(origin);
}

function boundedPort(value: string | undefined, fallback: number) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('STACKARR_MCP_HTTP_PORT is invalid.');
  return port;
}

function jsonError(response: import('node:http').ServerResponse, status: number, message: string) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32_000, message }, id: null }));
}

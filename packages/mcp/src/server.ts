import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStackarrTools } from './registry';

export function createStackarrMcpServer() {
  const server = new McpServer({ name: 'stackarr', version: '0.3.0-alpha.1' });
  registerStackarrTools(server);
  return server;
}

#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createStackarrMcpServer } from './server';

const server = createStackarrMcpServer();
await server.connect(new StdioServerTransport());

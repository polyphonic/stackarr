import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(frontendRoot, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: workspaceRoot,
  outputFileTracingExcludes: {
    '*': ['./next.config.mjs', 'next.config.mjs', 'apps/frontend/next.config.mjs']
  },
  transpilePackages: ['@stackarr/core', '@stackarr/ui'],
  turbopack: {
    root: workspaceRoot
  }
};

export default nextConfig;

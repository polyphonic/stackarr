import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import mdx from 'fumadocs-mdx/vite';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import { config as nextConfig } from './next.config.mjs';
import { loadEnvironment } from './scripts/cloudflare-env.mjs';

const stage = process.env.WORKERS_CI_BRANCH
  ? process.env.WORKERS_CI_BRANCH === 'production'
    ? 'production'
    : 'preview'
  : process.env.DEPLOYMENT_ENV === 'preview'
    ? 'preview'
    : 'production';
const environment = loadEnvironment(stage);
const vars = {
  ...Object.fromEntries(Object.entries(environment).filter(([name]) => name.startsWith('NEXT_PUBLIC_'))),
  DEPLOYMENT_PLATFORM: 'cloudflare',
  DEPLOYMENT_ENV: stage
};
for (const [name, value] of Object.entries(vars)) process.env[name] = String(value);

export default defineConfig({
  optimizeDeps: { exclude: ['@heroui/react', 'react-aria-components'] },
  resolve: { alias: { '@/.source/server': fileURLToPath(new URL('./.source-cloudflare/server.ts', import.meta.url)) } },
  css: { postcss: { plugins: [] } },
  plugins: [
    tailwindcss(),
    mdx(undefined, { outDir: '.source-cloudflare', updateViteConfig: false }),
    vinext({
      nextConfig: {
        reactStrictMode: true,
        transpilePackages: nextConfig.transpilePackages,
        rewrites: nextConfig.rewrites,
        headers: nextConfig.headers
      }
    }),
    cloudflare({ config: { vars }, viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] } })
  ]
});

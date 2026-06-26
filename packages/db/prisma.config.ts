import { defineConfig } from 'prisma/config';

const datasourceUrl =
  process.env.DIRECT_URL ||
  process.env.STACKARR_CLOUD_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://stackarr:stackarr@localhost:5432/stackarr';

if (requiresDatabaseUrl() && datasourceUrl.includes('@localhost:5432/stackarr')) {
  throw new Error('DIRECT_URL, STACKARR_CLOUD_DATABASE_URL, or DATABASE_URL is required for Prisma migrations.');
}

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations'
  },
  datasource: {
    url: datasourceUrl,
    ...(process.env.SHADOW_DATABASE_URL && {
      shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL
    })
  }
});

function requiresDatabaseUrl() {
  return process.argv.includes('migrate') || process.argv.includes('db');
}

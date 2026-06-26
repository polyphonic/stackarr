import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@stackarr/db/generated';
import { requireDatabaseUrl } from './env/server';

neonConfig.poolQueryViaFetch = true;

declare global {
  var stackarrPrisma: PrismaClient | undefined;
}

const connectionString = requireDatabaseUrl();
const adapter =
  process.env.NODE_ENV === 'development'
    ? new PrismaPg({ connectionString })
    : new PrismaNeon({ connectionString, connectionTimeoutMillis: 15_000 });

export const database =
  global.stackarrPrisma ||
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    transactionOptions: {
      maxWait: 10_000,
      timeout: 30_000
    }
  });

if (process.env.NODE_ENV === 'development') {
  global.stackarrPrisma = database;
}

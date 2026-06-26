import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceRepoRoot = path.resolve(/*turbopackIgnore: true*/ here, '../../..');

export const repoRoot = process.env.STACKARR_REPO_ROOT ? path.resolve(process.env.STACKARR_REPO_ROOT) : sourceRepoRoot;
export const stackRoot = path.join(/*turbopackIgnore: true*/ repoRoot, 'stackarr');
export const composePath = path.join(/*turbopackIgnore: true*/ stackRoot, 'docker-compose.yml');
export const stackarrBin = path.join(/*turbopackIgnore: true*/ repoRoot, 'bin', 'stackarr');
export const stackConfigRoot = path.join(/*turbopackIgnore: true*/ stackRoot, 'config');
export const stateRoot = path.join(/*turbopackIgnore: true*/ repoRoot, 'tmp', 'web-state');
export const taskStatePath = path.join(/*turbopackIgnore: true*/ stateRoot, 'tasks.json');
export const notificationConfigPath = path.join(/*turbopackIgnore: true*/ stackConfigRoot, 'notifications.json');
export const appSettingsPath = path.join(/*turbopackIgnore: true*/ stackConfigRoot, 'settings.json');
export const appDatabasePath =
  process.env.STACKARR_DATABASE_FILE ?? path.join(/*turbopackIgnore: true*/ stackConfigRoot, 'stackarr.db');

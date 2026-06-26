import { readEnv } from '../env';
import { getPlexServerStatusAction } from './plex';
import { getServiceStatusAction } from './services';

export const diagnoseServiceAction = (input: { service: string }) => getServiceStatusAction(input);
export const testServiceApiAction = (input: { service: string }) => getServiceStatusAction(input);
export const testServiceConnectivityAction = (input: { service: string }) => getServiceStatusAction(input);
export const testArrToDownloaderAction = () => ({
  status: 'notImplemented',
  note: 'Safe diagnostic placeholder; no services mutated.'
});
export const testProwlarrToArrAction = () => ({
  status: 'notImplemented',
  note: 'Safe diagnostic placeholder; no services mutated.'
});
export const testSeerrToArrAction = () => ({
  status: 'notImplemented',
  note: 'Safe diagnostic placeholder; no services mutated.'
});
export const testPlexIdentityAction = () => getPlexServerStatusAction();
export const getCommonIssuesAction = () => {
  const env = readEnv();
  const issues = [
    { id: 'missing-api-key', title: 'Missing API key', fix: 'Save the service API key in Stackarr configuration.' },
    { id: 'wrong-base-url', title: 'Wrong service base URL', fix: 'Set SERVICE_URL to the reachable address.' }
  ];

  if (/^(1|true|yes|on)$/i.test(env.ENABLE_4K_SERVARR ?? '')) {
    issues.push({
      id: 'seerr-sonarr4k',
      title: 'Seerr cannot reach Sonarr 4K',
      fix: 'Verify Seerr service settings point Sonarr 4K to http://sonarr4k:8989 inside Docker or the configured host URL from Seerr network.'
    });
  }

  return issues;
};
export const applySafeFixAction = (input: { fixId: 'refresh-status-cache' | 'none' }) => ({
  fixId: input.fixId,
  applied: input.fixId === 'refresh-status-cache',
  note: 'Only enumerated no-downtime safe fixes are allowed.'
});
export const checkServiceDatabasesAction = () => ({
  status: 'notImplemented',
  note: 'Database checks are pending; no services touched.'
});
export const validateSqliteDbAction = (input: { path: string }) => ({
  path: input.path,
  status: 'notImplemented',
  note: 'SQLite validation pending.'
});

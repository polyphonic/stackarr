#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const applicationConfigDirectories = new Map([
  ['Radarr', 'radarr'],
  ['Radarr 4K', 'radarr4k'],
  ['Sonarr', 'sonarr'],
  ['Sonarr 4K', 'sonarr4k'],
  ['Lidarr', 'lidarr']
]);

function readApiKey(configRoot, directory) {
  try {
    const contents = readFileSync(join(configRoot, directory, 'config.xml'), 'utf8');
    return contents.match(/<ApiKey>([^<]+)<\/ApiKey>/i)?.[1]?.trim() || '';
  } catch {
    return '';
  }
}

function withApiKey(application, apiKey) {
  const payload = structuredClone(application);
  const field = (payload.fields || []).find((item) => item.name === 'apiKey');
  if (!field) throw new Error(`${application.name} application has no API key field`);
  const changed = field.value !== apiKey;
  field.value = apiKey;
  return { payload, changed };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000), ...options });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return text ? JSON.parse(text) : {};
}

async function reconcileApplications({ configRoot, prowlarrUrl }) {
  if (!configRoot) throw new Error('CONFIG_ROOT is required');
  const prowlarrKey = readApiKey(configRoot, 'prowlarr');
  if (!prowlarrKey) throw new Error('Prowlarr API key is unavailable');

  const baseUrl = prowlarrUrl.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', 'X-Api-Key': prowlarrKey };
  const applications = await requestJson(`${baseUrl}/api/v1/applications`, { headers });
  let failures = 0;

  for (const application of applications) {
    const directory = applicationConfigDirectories.get(application.name);
    if (!directory) continue;
    const apiKey = readApiKey(configRoot, directory);
    if (!apiKey) {
      console.error(`WARN ${application.name} credentials skipped because its local API key is unavailable`);
      failures += 1;
      continue;
    }

    try {
      const { payload, changed } = withApiKey(application, apiKey);
      const body = JSON.stringify(payload);
      await requestJson(`${baseUrl}/api/v1/applications/test`, { method: 'POST', headers, body });
      if (changed) {
        await requestJson(`${baseUrl}/api/v1/applications/${application.id}`, { method: 'PUT', headers, body });
        console.log(`OK ${application.name} credentials updated`);
      } else {
        console.log(`OK ${application.name} credentials verified`);
      }
    } catch (error) {
      console.error(`WARN ${application.name} credential reconciliation failed: ${error.message}`);
      failures += 1;
    }
  }

  if (failures) throw new Error(`${failures} Prowlarr application credential reconciliation(s) failed`);
}

if (require.main === module) {
  reconcileApplications({
    configRoot: process.env.CONFIG_ROOT,
    prowlarrUrl: process.env.PROWLARR_URL || 'http://127.0.0.1:9696'
  }).catch((error) => {
    console.error(`ERROR ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { readApiKey, reconcileApplications, withApiKey };

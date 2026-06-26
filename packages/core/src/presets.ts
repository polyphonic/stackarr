import fs from 'node:fs';
import path from 'node:path';
import { stackConfigRoot } from './paths';

export const presetFiles = {
  naming: path.join(/*turbopackIgnore: true*/ stackConfigRoot, 'naming.json'),
  downloads: path.join(/*turbopackIgnore: true*/ stackConfigRoot, 'downloads.json'),
  requests: path.join(/*turbopackIgnore: true*/ stackConfigRoot, 'requests.json')
};

export function readJsonPreset(name: keyof typeof presetFiles) {
  const filePath = presetFiles[name];

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
}

export function writeJsonPreset(name: keyof typeof presetFiles, value: unknown) {
  fs.writeFileSync(presetFiles[name], `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

#!/usr/bin/env node
'use strict';
// Use the installed controller's exact local image ID; never pull a helper.
const { execFileSync } = require('node:child_process');
const ID = /^sha256:[a-f0-9]{64}$/;
function docker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}
function inspect(args, run) {
  const value = JSON.parse(run(['inspect', ...args]));
  if (!Array.isArray(value) || value.length !== 1 || !value[0]) throw Error('Invalid Docker inspect');
  return value[0];
}
function repository(reference) {
  const withoutDigest = reference.split('@')[0];
  const slash = withoutDigest.lastIndexOf('/');
  const colon = withoutDigest.lastIndexOf(':');
  return colon > slash ? withoutDigest.slice(0, colon) : withoutDigest;
}
function main({ env = process.env, run = docker, log = console.log } = {}) {
  const project = env.COMPOSE_PROJECT_NAME;
  const reference = env.STACKARR_IMAGE;
  if (!project || !/^[a-zA-Z0-9_-]{1,64}$/.test(project) || !reference)
    throw Error('Controller project/image unavailable');
  const daemonId = run(['info', '--format', '{{.ID}}']);
  if (!daemonId || daemonId.length > 128) throw Error('Docker daemon unavailable');
  const ids = run(['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length > 128 || ids.some((id) => !/^[a-f0-9]{12,64}$/.test(id)))
    throw Error('Invalid project container inventory');
  const controllers = ids
    .map((id) => inspect([id], run))
    .filter(
      (c) =>
        c.Config?.Labels?.['com.docker.compose.project'] === project &&
        typeof c.Config?.Labels?.['com.docker.compose.service'] === 'string' &&
        typeof c.Config?.Image === 'string' &&
        repository(c.Config.Image) === repository(reference) &&
        ID.test(c.Image || '')
    );
  if (controllers.length !== 1) throw Error('Installed controller image is ambiguous or missing');
  const imageId = controllers[0].Image;
  const image = inspect(['--type=image', imageId], run);
  if (image.Id !== imageId) throw Error('Installed image ID differs from local image');
  log(imageId);
  return imageId;
}
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Legacy volume helper HOLD: ${error.message}`);
    process.exitCode = 75;
  }
}
module.exports = { main };

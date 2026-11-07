#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { evaluateImageUpdate } = require('./image-update-policy.cjs');

const LIMIT = 1024 * 1024;
function boundedFd(fd) {
  const parts = [],
    chunk = Buffer.alloc(8192);
  let n,
    length = 0;
  while ((n = fs.readSync(fd, chunk, 0, chunk.length)) > 0) {
    if ((length += n) > LIMIT) throw Error('Input exceeds size limit');
    parts.push(Buffer.from(chunk.subarray(0, n)));
  }
  return Buffer.concat(parts).toString('utf8');
}
function matrix(file) {
  if (!file) return { services: {} };
  if (!path.isAbsolute(file)) throw Error('Release matrix path must be absolute');
  const fd = fs.openSync(file, 'r');
  try {
    if (!fs.fstatSync(fd).isFile()) throw Error('Release matrix must be regular file');
    return JSON.parse(boundedFd(fd));
  } finally {
    fs.closeSync(fd);
  }
}
function docker(args) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: LIMIT,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}
function inspect(id, run) {
  const result = JSON.parse(run(['inspect', id]));
  if (!Array.isArray(result) || result.length !== 1) throw Error('Invalid container inspection');
  return result[0];
}
async function main({
  args = process.argv.slice(2),
  env = process.env,
  input,
  run = docker,
  readEngine,
  log = console.log
} = {}) {
  if (!args.length || args.length > 128) throw Error('No services selected');
  if (input === undefined) input = boundedFd(0);
  if (input.length > LIMIT) throw Error('Compose input exceeds size limit');
  const compose = JSON.parse(input);
  if (!compose.services || typeof compose.services !== 'object') throw Error('Compose services unavailable');
  const releases = matrix(env.STACKARR_RELEASE_COMPATIBILITY_FILE);
  const project = env.COMPOSE_PROJECT_NAME || compose.name || 'stackarr';
  const seen = new Set();
  let blocked = false;
  for (const arg of args) {
    const matched = /^([a-z0-9][a-z0-9_-]{0,63})(?:=([a-f0-9]{12,64}))?$/.exec(arg);
    if (!matched || seen.has(matched[1]) || !Object.hasOwn(compose.services, matched[1]))
      throw Error('Invalid or duplicate service selection');
    const [, service, id] = matched;
    seen.add(service);
    if (!id) {
      log(`${service}: ALLOW — initial installation`);
      continue;
    }
    const container = inspect(id, run);
    if (
      !container?.Id?.startsWith(id) ||
      container.Config?.Labels?.['com.docker.compose.project'] !== project ||
      container.Config?.Labels?.['com.docker.compose.service'] !== service ||
      !/^sha256:[a-f0-9]{64}$/.test(container.Image || '')
    )
      throw Error(`Container identity or project mismatch for ${service}`);
    const candidate = { reference: compose.services[service].image };
    const current = { reference: container.Config.Image, imageId: container.Image };
    const record = releases?.services?.[service]?.releases?.[candidate.reference];
    const preliminary = evaluateImageUpdate({ service, current, candidate, release: record, update: true });
    let result = preliminary;
    if (
      preliminary.decision === 'ALLOW' &&
      record?.image === candidate.reference &&
      (record.requirements?.some((r) => r.version || r.extensions?.length) || record.incompatibilities?.length)
    ) {
      const { createReadEngine, requiredEnginesForService } = require('./image-dependency-probe.cjs');
      const daemonId = run(['info', '--format', '{{.ID}}']);
      const probe = readEngine || createReadEngine({ compose, env });
      const dependencies = requiredEnginesForService({ compose, env, service, project });
      const readings = {};
      for (const engine of new Set([
        ...(record.requirements || []).map((r) => r.engine),
        ...(record.incompatibilities || []).map((i) => i.engine)
      ])) {
        if (['postgresql', 'mariadb', 'redis'].includes(engine) && dependencies?.includes(engine)) {
          const reading = await probe(engine, { service, project, daemonId });
          if (reading) readings[engine] = reading;
        }
      }
      result = evaluateImageUpdate({
        service,
        current,
        candidate,
        release: record,
        readings,
        dependencies,
        update: true
      });
    }
    log(
      `${service}: ${result.decision} — ${result.reason}; running image ID: ${current.imageId}; candidate: ${candidate.reference}${result.warnings?.length ? `; WARN: ${result.warnings.join('; ')}` : ''}`
    );
    if (result.decision === 'HOLD') blocked = true;
  }
  return blocked ? 75 : 0;
}
if (require.main === module)
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      console.error('Image update HOLD: invalid service identity, release matrix, or inspection; no images pulled');
      process.exitCode = 75;
    });
module.exports = { main };

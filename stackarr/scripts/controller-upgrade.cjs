#!/usr/bin/env node
'use strict';

// Wrap only scoped controller replacement. Never prune project orphans or volumes.
const { execFileSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');

function docker(args, inherit = false) {
  try {
    return (
      execFileSync('docker', args, {
        encoding: 'utf8',
        stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
        timeout: 180000,
        maxBuffer: 16 * 1024 * 1024
      }) || ''
    );
  } catch {
    // Inspect/config can contain credentials. Do not replay their buffers.
    throw new Error(`Docker ${args[0]} failed during controller transition`);
  }
}

function identity(container, project, service) {
  const labels = container.Config?.Labels || {};
  if (
    !/^[a-f0-9]{64}$/.test(container.Id || '') ||
    labels['com.docker.compose.project'] !== project ||
    labels['com.docker.compose.service'] !== service ||
    String(labels['com.docker.compose.oneoff']).toLowerCase() !== 'false' ||
    labels['org.opencontainers.image.title'] !== 'Stackarr' ||
    !(container.Config?.Env || []).includes('STACKARR_RUNTIME=docker') ||
    !(container.Config?.Env || []).includes(`STACKARR_CONTAINER_NAME=${service}`)
  )
    throw new Error(`Unverified ${service} controller identity; no automatic transition`);
  return container;
}

function preserveStorage(old, config) {
  const desired = config.services?.stackarr;
  if (!desired) throw new Error('Replacement controller missing from Compose');
  for (const target of ['/stackarr-config', '/stackarr-state']) {
    const before = old.Mounts?.find((mount) => mount.Destination === target);
    const after = desired.volumes?.find((mount) => mount.target === target);
    const source = after?.type === 'volume' ? config.volumes?.[after.source]?.name : after?.source;
    if (
      !before ||
      !after ||
      before.Type !== after.type ||
      !source ||
      (before.Type === 'volume' ? before.Name : before.Source) !== source ||
      !before.RW ||
      after.read_only
    ) {
      throw new Error(`Controller storage changed at ${target}; migrate data separately`);
    }
  }
}

async function transition(project, args, io = {}) {
  const run = io.docker || docker;
  const pause = io.sleep || sleep;
  const up = args.indexOf('up');
  if (
    !/^[a-z0-9][a-z0-9_-]*$/.test(project) ||
    args[0] !== 'compose' ||
    args[args.indexOf('--project-name') + 1] !== project ||
    up < 0 ||
    args.at(-1) !== 'stackarr'
  )
    throw new Error('Expected a project-bound controller Compose up');
  const list = (service) =>
    run([
      'ps',
      '--all',
      '--quiet',
      '--no-trunc',
      '--filter',
      `label=com.docker.compose.project=${project}`,
      '--filter',
      `label=com.docker.compose.service=${service}`
    ])
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  const inspect = (id, service) => {
    const values = JSON.parse(run(['inspect', id]));
    if (values.length !== 1 || values[0].Id !== id) throw new Error('Controller identity changed');
    return identity(values[0], project, service);
  };
  const legacy = list('app');
  if (!legacy.length) {
    run(args, true);
    return { migrated: false };
  }
  if (legacy.length !== 1 || list('stackarr').length) {
    throw new Error('Ambiguous controller inventory; leave both generations unchanged for recovery');
  }
  // Fail before stopping the old service if a caller could affect other apps.
  const options = args.slice(up + 1, -1);
  if (
    !options.includes('--no-deps') ||
    options.some(
      (arg) =>
        !['-d', '--detach', '--no-deps', '--force-recreate', '--wait', '--pull', 'never', 'missing', 'always'].includes(
          arg
        )
    )
  ) {
    throw new Error('Legacy controller transition requires scoped --no-deps up without orphan removal');
  }
  const old = inspect(legacy[0], 'app');
  if (!['running', 'exited', 'created'].includes(old.State?.Status))
    throw new Error('Legacy controller is not in a stable state');
  if (process.env.STACKARR_RUNTIME === 'docker' && process.env.STACKARR_CONTAINER_NAME === 'app') {
    throw new Error('Legacy controller must be replaced by the independent updater or host CLI');
  }
  const config = JSON.parse(run([...args.slice(0, up), 'config', '--format', 'json']));
  preserveStorage(old, config);
  const policy = old.HostConfig?.RestartPolicy;
  if (
    !['no', 'always', 'unless-stopped', 'on-failure'].includes(policy?.Name) ||
    !Number.isInteger(policy.MaximumRetryCount) ||
    policy.MaximumRetryCount < 0
  )
    throw new Error('Invalid prior restart policy');
  const restart =
    policy.Name === 'on-failure' && policy.MaximumRetryCount
      ? `${policy.Name}:${policy.MaximumRetryCount}`
      : policy.Name;
  const timeout = Number(io.timeoutMs ?? 120000);
  let committed = false;
  let held = false;
  let replacement;
  try {
    // Retain the exact old object and its image until replacement health passes.
    held = true;
    run(['update', '--restart=no', old.Id]);
    run(['stop', '--time', '30', old.Id]);
    const stopped = inspect(old.Id, 'app');
    if (stopped.State.Running || stopped.HostConfig.RestartPolicy.Name !== 'no')
      throw new Error('Legacy controller did not stop safely');
    run(args, true);
    const ids = list('stackarr');
    if (ids.length !== 1) throw new Error('Replacement controller is not unique');
    replacement = inspect(ids[0], 'stackarr');
    const started = Date.now();
    while (true) {
      const current = inspect(replacement.Id, 'stackarr');
      if (!current.State.Running || current.RestartCount !== replacement.RestartCount)
        throw new Error('Replacement controller stopped or restarted');
      try {
        run([
          'exec',
          replacement.Id,
          'node',
          '-e',
          "fetch('http://127.0.0.1:'+(process.env.STACKARR_WEB_PORT||7777)+'/api/v1/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
        ]);
        break;
      } catch {
        if (Date.now() - started >= timeout) throw new Error('Replacement controller health timed out');
        await pause(1000);
      }
    }
    // Once healthy, a failed old-object cleanup must not roll back a good service.
    committed = true;
    inspect(old.Id, 'app');
    run(['rm', old.Id]); // no force and no -v: persistent data is never deleted
    if (list('app').length) throw new Error('Legacy controller retirement could not be verified');
    return { migrated: true, previousId: old.Id, controllerId: replacement.Id };
  } catch (error) {
    if (held && !committed) {
      try {
        const ids = list('stackarr');
        if (ids.length > 1 || (replacement && ids.some((id) => id !== replacement.Id)))
          throw new Error('Replacement identity changed');
        for (const id of ids) {
          inspect(id, 'stackarr');
          run(['update', '--restart=no', id]);
          run(['stop', '--time', '30', id]);
          run(['rm', id]);
        }
        inspect(old.Id, 'app');
        run(['update', `--restart=${restart}`, old.Id]);
        if (old.State.Running) run(['start', old.Id]);
        const restored = inspect(old.Id, 'app');
        if (
          restored.State.Running !== old.State.Running ||
          restored.HostConfig.RestartPolicy.Name !== policy.Name ||
          restored.HostConfig.RestartPolicy.MaximumRetryCount !== policy.MaximumRetryCount
        )
          throw new Error('Prior state was not restored');
      } catch {
        throw new Error(
          `Controller transition failed; automatic recovery incomplete. Retained legacy ID ${old.Id}; inspect both project controllers before retrying`
        );
      }
      throw new Error(`${error.message}; original controller and restart policy restored`);
    }
    throw error;
  }
}

module.exports = { transition, identity, preserveStorage };
if (require.main === module) {
  const [project, executable, ...args] = process.argv.slice(2);
  if (executable !== 'docker') throw new Error('Only Docker Compose is supported');
  transition(project, args)
    .then((result) => {
      if (result.migrated)
        console.log('Legacy controller replaced and retired; persistent data and unrelated services retained');
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

#!/usr/bin/env node
const crypto = require('node:crypto');
const { appendTaskOutput, patchTask, upsertTask } = require('./stackarr-db.cjs');

const action = process.argv[2];
const args = process.argv.slice(3);

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  return args[index + 1] ?? fallback;
}

function flag(name) {
  return args.includes(name);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function now() {
  return new Date().toISOString();
}

if (action === 'create') {
  const timestamp = now();
  const id = option('--id', crypto.randomUUID());
  upsertTask({
    id,
    commandName: option('--command', 'Backup'),
    commandLabel: option('--label', 'Run backup'),
    status: option('--status', 'running'),
    queuedAt: option('--queued-at', timestamp),
    startedAt: option('--started-at', timestamp),
    output: option('--output', undefined)
  });
  process.stdout.write(`${id}\n`);
  process.exit(0);
}

if (action === 'append') {
  const id = args[0];
  const output = args.slice(1).join(' ');
  if (!id) {
    fail('Usage: task-log.cjs append <task-id> <output>');
  }
  if (output) {
    appendTaskOutput(id, output);
  }
  process.exit(0);
}

if (action === 'update') {
  const id = args[0];
  if (!id) {
    fail('Usage: task-log.cjs update <task-id> [--status status] [--exit-code code]');
  }

  const patch = {};
  const status = option('--status', undefined);
  const exitCode = option('--exit-code', undefined);
  const output = option('--output', undefined);
  const appendOutput = option('--append-output', undefined);
  const error = option('--error', undefined);

  if (status !== undefined) {
    patch.status = status;
  }
  if (flag('--started-now')) {
    patch.startedAt = now();
  }
  if (flag('--ended-now')) {
    patch.endedAt = now();
  }
  if (exitCode !== undefined) {
    patch.exitCode = Number(exitCode);
  }
  if (output !== undefined) {
    patch.output = output;
  }
  if (appendOutput !== undefined) {
    patch.appendOutput = appendOutput;
  }
  if (error !== undefined) {
    patch.error = error;
  }

  patchTask(id, patch);
  process.exit(0);
}

fail('Usage: task-log.cjs create|append|update');

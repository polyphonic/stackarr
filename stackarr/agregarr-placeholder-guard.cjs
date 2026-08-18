#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const cleanupTarget = process.argv[2];
const placeholderManagerTarget = process.argv[3];
const runtimeUid = process.argv[4];
const runtimeGid = process.argv[5];
const runtimeCommand = process.argv.slice(6);

function fail(message) {
  process.stderr.write(`Stackarr Agregarr placeholder guard: ${message}\n`);
  process.exit(1);
}

if (!cleanupTarget || !placeholderManagerTarget) {
  fail('missing upstream module paths; refusing to start Agregarr');
}

function planGuard(target, vulnerableNeedle, guardedNeedle, label) {
  let source;
  try {
    source = fs.readFileSync(target, 'utf8');
  } catch (error) {
    fail(`could not read ${target}; refusing to start Agregarr (${error.message})`);
  }

  const vulnerableCount = source.split(vulnerableNeedle).length - 1;
  const guardedCount = source.split(guardedNeedle).length - 1;
  if (guardedCount === 1 && vulnerableCount === 0) {
    return { changed: false, guardedSource: source, label, target };
  }
  if (vulnerableCount !== 1 || guardedCount !== 0) {
    fail(`upstream ${label} code is unrecognized; refusing to start Agregarr to prevent a destructive sync`);
  }
  return { changed: true, guardedSource: source.replace(vulnerableNeedle, guardedNeedle), label, target };
}

function applyGuard(plan) {
  if (!plan.changed) {
    process.stdout.write(`Stackarr Agregarr placeholder guard: ${plan.label} protection is active\n`);
    return;
  }

  const temporary = `${plan.target}.stackarr.tmp`;
  try {
    const mode = fs.statSync(plan.target).mode;
    fs.writeFileSync(temporary, plan.guardedSource, { encoding: 'utf8', mode });
    fs.renameSync(temporary, plan.target);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // The original target is untouched if temporary-file cleanup also fails.
    }
    fail(`could not protect ${path.basename(plan.target)}; refusing to start Agregarr (${error.message})`);
  }
  process.stdout.write(`Stackarr Agregarr placeholder guard: enabled ${plan.label} protection\n`);
}

const plans = [
  planGuard(
    cleanupTarget,
    'const isStale = placeholder.createdAt &&',
    'const isStale = isOrphaned &&\n                    placeholder.createdAt &&',
    'source-membership'
  ),
  planGuard(
    placeholderManagerTarget,
    "const yearStr = year ? ` (${year})` : '';\n    const showDir = path_1.default.join(libraryPath, `${sanitizedTitle}${yearStr}`);",
    "const yearStr = year && !sanitizedTitle.endsWith(` (${year})`) ? ` (${year})` : '';\n    const showDir = path_1.default.join(libraryPath, `${sanitizedTitle}${yearStr}`);",
    'TV title-year'
  )
];
plans.forEach(applyGuard);

if (runtimeCommand.length === 0) {
  process.exit(0);
}

if (!/^\d+$/.test(runtimeUid ?? '') || !/^\d+$/.test(runtimeGid ?? '')) {
  fail('runtime UID and GID must be numeric; refusing to start Agregarr as root');
}

try {
  process.setgroups([]);
  process.setgid(Number(runtimeGid));
  process.setuid(Number(runtimeUid));
} catch (error) {
  fail(`could not drop runtime privileges; refusing to start Agregarr as root (${error.message})`);
}

const child = spawn(runtimeCommand[0], runtimeCommand.slice(1), { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => child.kill(signal));
}
child.once('error', (error) => fail(`could not launch Agregarr (${error.message})`));
child.once('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

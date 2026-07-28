#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');

const MAGIC = Buffer.from('STACKARR-BACKUP\0', 'ascii');
const VERSION = 1;
const KEY_ID_BYTES = 8;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + 1 + KEY_ID_BYTES + IV_BYTES;

function fail(message) {
  process.stderr.write(`Backup encryption failed: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { command: argv[2] || '' };
  for (let index = 3; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--key-file', '--input', '--output'].includes(key) || !value) fail(`unknown or incomplete argument: ${key}`);
    args[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return args;
}

function decodeKey(text) {
  const value = text.trim();
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (key.length !== 32) fail('key file must contain exactly 32 random bytes encoded as base64 or hex');
  return key;
}

function readKey(filePath) {
  if (!filePath || !fs.existsSync(filePath)) fail('backup key file was not found');
  return decodeKey(fs.readFileSync(filePath, 'utf8'));
}

function keyId(key) {
  return crypto.createHash('sha256').update(key).digest().subarray(0, KEY_ID_BYTES);
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) await once(stream, 'drain');
}

async function generateKey(args) {
  if (!args.keyFile) fail('--key-file is required');
  fs.mkdirSync(path.dirname(args.keyFile), { recursive: true });

  try {
    fs.writeFileSync(args.keyFile, `${crypto.randomBytes(32).toString('base64')}\n`, {
      mode: 0o600,
      flag: 'wx'
    });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }

  fs.chmodSync(args.keyFile, 0o600);
  const key = readKey(args.keyFile);
  process.stdout.write(`${keyId(key).toString('hex')}\n`);
}

async function encrypt(args) {
  if (!args.keyFile || !args.output) fail('--key-file and --output are required');
  const key = readKey(args.keyFile);
  const iv = crypto.randomBytes(IV_BYTES);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION]), keyId(key), iv]);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  const temporary = `${args.output}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const output = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });

  try {
    await writeChunk(output, header);
    for await (const chunk of process.stdin) await writeChunk(output, cipher.update(chunk));
    await writeChunk(output, cipher.final());
    await writeChunk(output, cipher.getAuthTag());
    output.end();
    await once(output, 'close');
    fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, args.output);
  } catch (error) {
    output.destroy();
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

async function decrypt(args) {
  if (!args.keyFile || !args.input) fail('--key-file and --input are required');
  const key = readKey(args.keyFile);
  const size = fs.statSync(args.input).size;
  if (size <= HEADER_BYTES + TAG_BYTES) fail('encrypted archive is truncated');

  const descriptor = fs.openSync(args.input, 'r');
  const header = Buffer.alloc(HEADER_BYTES);
  const tag = Buffer.alloc(TAG_BYTES);
  fs.readSync(descriptor, header, 0, header.length, 0);
  fs.readSync(descriptor, tag, 0, tag.length, size - TAG_BYTES);
  fs.closeSync(descriptor);

  if (!header.subarray(0, MAGIC.length).equals(MAGIC) || header[MAGIC.length] !== VERSION) {
    fail('encrypted archive header is unsupported');
  }
  const expectedKeyId = header.subarray(MAGIC.length + 1, MAGIC.length + 1 + KEY_ID_BYTES);
  if (!crypto.timingSafeEqual(expectedKeyId, keyId(key))) fail('backup key does not match this archive');

  const iv = header.subarray(HEADER_BYTES - IV_BYTES);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const input = fs.createReadStream(args.input, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 });

  try {
    for await (const chunk of input) {
      const clear = decipher.update(chunk);
      if (clear.length && !process.stdout.write(clear)) await once(process.stdout, 'drain');
    }
    const final = decipher.final();
    if (final.length) process.stdout.write(final);
  } catch {
    fail('archive authentication failed; the key is wrong or the backup is damaged');
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.command === 'generate-key') await generateKey(args);
  else if (args.command === 'key-id') process.stdout.write(`${keyId(readKey(args.keyFile)).toString('hex')}\n`);
  else if (args.command === 'encrypt') await encrypt(args);
  else if (args.command === 'decrypt') await decrypt(args);
  else fail(`unknown command: ${args.command || '(missing)'}`);
}

main().catch((error) => fail(error instanceof Error ? error.message : 'unknown error'));

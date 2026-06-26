import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { stackConfigRoot } from './paths';

const encryptedPrefix = 'stackarr:v1:';
const keyFile = path.join(stackConfigRoot, 'stackarr.secret');

export function isEncryptedSecret(value: unknown) {
  return typeof value === 'string' && value.startsWith(encryptedPrefix);
}

export function encryptSecret(value: unknown) {
  if (typeof value !== 'string' || value.length === 0 || isEncryptedSecret(value)) {
    return value;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getSecretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    encryptedPrefix.slice(0, -1),
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url')
  ].join(':');
}

export function decryptSecret(value: unknown) {
  if (!isEncryptedSecret(value)) {
    return value;
  }

  const [, version, ivText, tagText, ciphertextText] = String(value).split(':');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText) {
    throw new Error('Unsupported encrypted secret format.');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', getSecretKey(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]);

  return plaintext.toString('utf8');
}

function getSecretKey() {
  const configured = process.env.STACKARR_SECRET_KEY?.trim();
  if (configured) {
    return crypto.createHash('sha256').update(configured).digest();
  }

  fs.mkdirSync(stackConfigRoot, { recursive: true });

  if (!fs.existsSync(keyFile)) {
    fs.writeFileSync(keyFile, `${crypto.randomBytes(32).toString('base64url')}\n`, { mode: 0o600 });
  }

  return crypto.createHash('sha256').update(fs.readFileSync(keyFile, 'utf8').trim()).digest();
}

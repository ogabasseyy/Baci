import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from 'node:crypto';
import type { z } from 'zod';
import type { giglTrackingTokenCacheRecordSchema } from '@/schemas/gigl-tracking-token-cache';
import type { GiglToken } from './gigl.constants';

export type CacheCredentials = {
  baseUrl: string;
  email: string;
  password: string;
};
type Record = z.infer<typeof giglTrackingTokenCacheRecordSchema>;

function deriveKey(
  credentials: CacheCredentials,
  salt: Buffer
): Promise<Buffer> {
  const secret = JSON.stringify([
    credentials.baseUrl,
    credentials.email,
    credentials.password,
  ]);
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, 32, { N: 16384, r: 8, p: 1 }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function encryptGiglToken(
  credentials: CacheCredentials,
  token: GiglToken
): Promise<Record> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(credentials, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv, {
      authTagLength: 16,
    });
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(token), 'utf8'),
      cipher.final(),
    ]);
    return {
      version: 1,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      tag: cipher.getAuthTag().toString('hex'),
      ciphertext: ciphertext.toString('base64'),
    };
  } finally {
    key.fill(0);
  }
}

export async function decryptGiglToken(
  credentials: CacheCredentials,
  record: Record
): Promise<unknown> {
  const key = await deriveKey(credentials, Buffer.from(record.salt, 'hex'));
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(record.iv, 'hex'),
      { authTagLength: 16 }
    );
    decipher.setAuthTag(Buffer.from(record.tag, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as unknown;
  } finally {
    key.fill(0);
  }
}

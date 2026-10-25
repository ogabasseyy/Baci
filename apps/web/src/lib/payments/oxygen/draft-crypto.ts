import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  type OxygenFormDraft,
  oxygenFormDraftSchema,
} from '@/schemas/oxygen-form-draft';

type Context = { userId: string; workflowId: string; version: number };
function keyBytes(key: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error('Draft storage unavailable');
  return Buffer.from(key, 'hex');
}
const aad = (context: Context) =>
  Buffer.from(
    JSON.stringify([
      'oxygen-form-draft:v1',
      context.userId,
      context.workflowId,
      context.version,
    ])
  );

export function encryptOxygenDraft(
  draft: OxygenFormDraft,
  key: string,
  context: Context
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(oxygenFormDraftSchema.parse(draft)), 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptOxygenDraft(
  payload: string,
  key: string,
  context: Context
): OxygenFormDraft {
  const [version, iv, tag, encrypted, extra] = payload.split('.');
  if (version !== 'v1' || !iv || !tag || !encrypted || extra)
    throw new Error('Draft storage unavailable');
  const ivBytes = Buffer.from(iv, 'base64url');
  const tagBytes = Buffer.from(tag, 'base64url');
  if (ivBytes.length !== 12 || tagBytes.length !== 16)
    throw new Error('Draft storage unavailable');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(key), ivBytes);
  decipher.setAAD(aad(context));
  decipher.setAuthTag(tagBytes);
  const raw = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]);
  return oxygenFormDraftSchema.parse(JSON.parse(raw.toString('utf8')));
}

import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  type OxygenFormDraft,
  oxygenFormDraftSchema,
} from '@/schemas/oxygen-form-draft';
import { oxygenPurposeKey, oxygenWriteVersion } from './purpose-key-crypto';

type Context = {
  userId: string;
  workflowId: string;
  version: number;
  purpose?: 'residential';
};
function keyBytes(key: string): Buffer {
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error('Draft storage unavailable');
  return Buffer.from(key, 'hex');
}
const aad = (context: Context, version: 'v1' | 'v2') =>
  Buffer.from(
    JSON.stringify([
      context.purpose === 'residential'
        ? `oxygen-residential-draft:${version}`
        : `oxygen-form-draft:${version}`,
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
  const version = oxygenWriteVersion();
  const iv = randomBytes(12);
  const root = keyBytes(key);
  const purpose =
    context.purpose === 'residential' ? 'residential-draft' : 'form-draft';
  const cipher = createCipheriv(
    'aes-256-gcm',
    version === 'v2' ? oxygenPurposeKey(root, purpose) : root,
    iv
  );
  cipher.setAAD(aad(context, version));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(oxygenFormDraftSchema.parse(draft)), 'utf8'),
    cipher.final(),
  ]);
  return [
    version,
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
  if (
    (version !== 'v1' && version !== 'v2') ||
    !iv ||
    !tag ||
    !encrypted ||
    extra
  )
    throw new Error('Draft storage unavailable');
  const ivBytes = Buffer.from(iv, 'base64url');
  const tagBytes = Buffer.from(tag, 'base64url');
  if (ivBytes.length !== 12 || tagBytes.length !== 16)
    throw new Error('Draft storage unavailable');
  const root = keyBytes(key);
  const purpose =
    context.purpose === 'residential' ? 'residential-draft' : 'form-draft';
  const decipher = createDecipheriv(
    'aes-256-gcm',
    version === 'v2' ? oxygenPurposeKey(root, purpose) : root,
    ivBytes,
    {
      authTagLength: 16,
    }
  );
  decipher.setAAD(aad(context, version));
  decipher.setAuthTag(tagBytes);
  const raw = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]);
  return oxygenFormDraftSchema.parse(JSON.parse(raw.toString('utf8')));
}

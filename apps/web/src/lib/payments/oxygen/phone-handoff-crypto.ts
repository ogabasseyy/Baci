import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { oxygenPhoneTargetSchema } from '@/schemas/oxygen-phone-handoff';
import { oxygenPurposeKey, oxygenWriteVersion } from './purpose-key-crypto';

type Context = {
  hash: string;
  workflowId: string;
  applicationReference: string;
  environment: 'staging' | 'production';
};
const aad = (c: Context, version: 'v1' | 'v2' | 'v3') =>
  Buffer.from(
    JSON.stringify([
      `oxygen-phone:${version}`,
      c.hash,
      c.workflowId,
      c.applicationReference,
      c.environment,
    ])
  );
function keyBytes(key: string) {
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error('Phone verification unavailable');
  return Buffer.from(key, 'hex');
}
function independentPhoneKey(
  context: Pick<Context, 'environment'>,
  legacyRoot: Buffer
): Buffer {
  const prefix =
    context.environment === 'production'
      ? 'OXYGEN_PRODUCTION'
      : 'OXYGEN_STAGING';
  const secret = process.env[`${prefix}_PHONE_HANDOFF_ENCRYPTION_KEY`];
  if (!secret || !/^[a-f0-9]{64}$/i.test(secret))
    throw new Error('Phone verification unavailable');
  const key = Buffer.from(secret, 'hex');
  if (key.equals(legacyRoot)) throw new Error('Phone verification unavailable');
  return key;
}
function writeVersion(
  context: Pick<Context, 'environment'>
): 'v1' | 'v2' | 'v3' {
  const prefix =
    context.environment === 'production'
      ? 'OXYGEN_PRODUCTION'
      : 'OXYGEN_STAGING';
  return process.env[`${prefix}_PHONE_KEY_V3_WRITE`] === 'true'
    ? 'v3'
    : oxygenWriteVersion();
}
export function assertPhoneEncryptionReady(
  key: string,
  environment: Context['environment']
): void {
  const root = keyBytes(key);
  if (writeVersion({ environment }) === 'v3')
    independentPhoneKey({ environment }, root);
}
export function encryptPhoneTarget(
  url: string,
  key: string,
  context: Context
): string {
  const version = writeVersion(context);
  const iv = randomBytes(12);
  const root = keyBytes(key);
  const cipher = createCipheriv(
    'aes-256-gcm',
    version === 'v3'
      ? independentPhoneKey(context, root)
      : version === 'v2'
        ? oxygenPurposeKey(root, 'phone-handoff')
        : root,
    iv
  );
  cipher.setAAD(aad(context, version));
  const bytes = Buffer.concat([
    cipher.update(
      JSON.stringify(oxygenPhoneTargetSchema.parse({ url })),
      'utf8'
    ),
    cipher.final(),
  ]);
  return [
    version,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    bytes.toString('base64url'),
  ].join('.');
}
export function decryptPhoneTarget(
  payload: string,
  key: string,
  context: Context
): string {
  const [version, iv, tag, value, extra] = payload.split('.');
  if (
    (version !== 'v1' && version !== 'v2' && version !== 'v3') ||
    !iv ||
    !tag ||
    !value ||
    extra
  )
    throw new Error('Phone verification unavailable');
  const nonce = Buffer.from(iv, 'base64url');
  const authTag = Buffer.from(tag, 'base64url');
  if (nonce.length !== 12 || authTag.length !== 16)
    throw new Error('Phone verification unavailable');
  const root = keyBytes(key);
  const cipher = createDecipheriv(
    'aes-256-gcm',
    version === 'v3'
      ? independentPhoneKey(context, root)
      : version === 'v2'
        ? oxygenPurposeKey(root, 'phone-handoff')
        : root,
    nonce,
    {
      authTagLength: 16,
    }
  );
  cipher.setAAD(aad(context, version));
  cipher.setAuthTag(authTag);
  const bytes = Buffer.concat([
    cipher.update(Buffer.from(value, 'base64url')),
    cipher.final(),
  ]);
  return oxygenPhoneTargetSchema.parse(JSON.parse(bytes.toString('utf8'))).url;
}

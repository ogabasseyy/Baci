import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { oxygenPhoneTargetSchema } from '@/schemas/oxygen-phone-handoff';

type Context = {
  hash: string;
  workflowId: string;
  applicationReference: string;
  environment: 'staging' | 'production';
};
const aad = (c: Context) =>
  Buffer.from(
    JSON.stringify([
      'oxygen-phone:v1',
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
export function encryptPhoneTarget(
  url: string,
  key: string,
  context: Context
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv);
  cipher.setAAD(aad(context));
  const bytes = Buffer.concat([
    cipher.update(
      JSON.stringify(oxygenPhoneTargetSchema.parse({ url })),
      'utf8'
    ),
    cipher.final(),
  ]);
  return [
    'v1',
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
  if (version !== 'v1' || !iv || !tag || !value || extra)
    throw new Error('Phone verification unavailable');
  const nonce = Buffer.from(iv, 'base64url');
  const authTag = Buffer.from(tag, 'base64url');
  if (nonce.length !== 12 || authTag.length !== 16)
    throw new Error('Phone verification unavailable');
  const cipher = createDecipheriv('aes-256-gcm', keyBytes(key), nonce, {
    authTagLength: 16,
  });
  cipher.setAAD(aad(context));
  cipher.setAuthTag(authTag);
  const bytes = Buffer.concat([
    cipher.update(Buffer.from(value, 'base64url')),
    cipher.final(),
  ]);
  return oxygenPhoneTargetSchema.parse(JSON.parse(bytes.toString('utf8'))).url;
}

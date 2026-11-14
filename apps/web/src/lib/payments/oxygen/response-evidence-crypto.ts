import 'server-only';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import type { projectOxygenResponse } from './response-evidence';

export function oxygenEvidenceKeyBytes(secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(secret))
    throw new Error('Response evidence unavailable');
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret, 'hex'),
      Buffer.alloc(0),
      'oxygen-response-evidence:v1',
      32
    )
  );
}
const aad = (workflowId: string, commandId: string, sequence: number) =>
  Buffer.from(
    JSON.stringify([
      'oxygen-response-evidence:v1',
      workflowId,
      commandId,
      sequence,
    ])
  );
export function encryptOxygenResponse(
  payload: ReturnType<typeof projectOxygenResponse>,
  secret: string,
  workflowId: string,
  commandId: string,
  sequence: number
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    oxygenEvidenceKeyBytes(secret),
    iv
  );
  cipher.setAAD(aad(workflowId, commandId, sequence));
  const bytes = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    bytes.toString('base64url'),
  ].join('.');
}
export function decryptOxygenResponse(
  ciphertext: string,
  secret: string,
  workflowId: string,
  commandId: string,
  sequence: number
): unknown {
  const [version, iv, tag, body, extra] = ciphertext.split('.');
  if (
    version !== 'v1' ||
    !iv ||
    !tag ||
    !body ||
    extra ||
    Buffer.from(iv, 'base64url').length !== 12 ||
    Buffer.from(tag, 'base64url').length !== 16
  )
    throw new Error('Response evidence unavailable');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    oxygenEvidenceKeyBytes(secret),
    Buffer.from(iv, 'base64url'),
    { authTagLength: 16 }
  );
  decipher.setAAD(aad(workflowId, commandId, sequence));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(body, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  ) as unknown;
}

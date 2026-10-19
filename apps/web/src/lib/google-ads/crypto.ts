import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

function encode(value: Buffer): string {
  return value.toString('base64url');
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function keyBytes(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  const decoded = decode(trimmed);
  if (decoded.length !== 32) {
    throw new Error('Google Ads token encryption key must be 32 bytes');
  }
  return decoded;
}

export function encryptGoogleAdsSecret(
  secret: string,
  encryptionKey: string
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(encryptionKey), iv, {
    authTagLength: 16,
  });
  const ciphertext = Buffer.concat([
    cipher.update(secret, 'utf8'),
    cipher.final(),
  ]);
  return `v1.${encode(iv)}.${encode(cipher.getAuthTag())}.${encode(ciphertext)}`;
}

export function decryptGoogleAdsSecret(
  encoded: string,
  encryptionKey: string
): string {
  const [version, ivPart, tagPart, ciphertextPart] = encoded.split('.');
  if (version !== 'v1' || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error('Unsupported Google Ads secret format');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyBytes(encryptionKey),
    decode(ivPart),
    { authTagLength: 16 }
  );
  decipher.setAuthTag(decode(tagPart));
  return Buffer.concat([
    decipher.update(decode(ciphertextPart)),
    decipher.final(),
  ]).toString('utf8');
}

export function createGoogleAdsOAuthStateSignature(
  payload: string,
  secret: string
): string {
  return encode(createHmac('sha256', secret).update(payload).digest());
}

export function constantTimeStringEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function generateGoogleAdsRandomValue(byteLength = 32): string {
  return encode(randomBytes(byteLength));
}

export function createGoogleAdsPkceChallenge(verifier: string): string {
  return encode(createHash('sha256').update(verifier).digest());
}

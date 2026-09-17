import 'server-only';

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  type AdsOAuthStorageProvider,
  isAdsOAuthStorageProvider,
} from './contract';

function encode(value: Buffer): string {
  return value.toString('base64url');
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function encryptionKeyBytes(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  const decoded = decode(trimmed);
  if (decoded.length !== 32) {
    throw new Error('Ads token encryption key must be exactly 32 bytes');
  }
  return decoded;
}

function providerAad(provider: AdsOAuthStorageProvider): Buffer {
  return Buffer.from(`baci:ads:${provider}:token`, 'utf8');
}

export function encryptAdsToken(
  token: string,
  encryptionKey: string,
  provider: AdsOAuthStorageProvider
): string {
  if (!isAdsOAuthStorageProvider(provider)) {
    throw new Error('Google Ads must use its legacy v1 token path');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    'aes-256-gcm',
    encryptionKeyBytes(encryptionKey),
    iv,
    { authTagLength: 16 }
  );
  cipher.setAAD(providerAad(provider));
  const ciphertext = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ]);
  return `v2.${provider}.${encode(iv)}.${encode(cipher.getAuthTag())}.${encode(ciphertext)}`;
}

export function decryptAdsToken(
  encoded: string,
  encryptionKey: string,
  provider: AdsOAuthStorageProvider
): string {
  const [version, encodedProvider, ivPart, tagPart, ciphertextPart, extra] =
    encoded.split('.');
  if (
    version !== 'v2' ||
    !encodedProvider ||
    !isAdsOAuthStorageProvider(encodedProvider) ||
    encodedProvider !== provider ||
    !ivPart ||
    !tagPart ||
    !ciphertextPart ||
    extra
  ) {
    throw new Error('Unsupported ads token ciphertext');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKeyBytes(encryptionKey),
    decode(ivPart),
    { authTagLength: 16 }
  );
  decipher.setAAD(providerAad(provider));
  decipher.setAuthTag(decode(tagPart));
  return Buffer.concat([
    decipher.update(decode(ciphertextPart)),
    decipher.final(),
  ]).toString('utf8');
}

export function createAdsStateSignature(
  payload: string,
  secret: string
): string {
  return encode(createHmac('sha256', secret).update(payload).digest());
}

export function timingSafeStringEqual(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function generateAdsRandomValue(byteLength = 32): string {
  return encode(randomBytes(byteLength));
}

export function createAdsPkceChallenge(verifier: string): string {
  return encode(createHash('sha256').update(verifier).digest());
}

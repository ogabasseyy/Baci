import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const VERSION_WITH_AAD = 2;
const LEGACY_VERSION = 1;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

type JumiaAuthorizationCredentials = {
  clientId: string;
  refreshToken: string;
  accessToken: string;
};

type SerializedAuthorization = {
  v: number;
  iv: string;
  tag: string;
  data: string;
};

export class JumiaAuthorizationDecryptionError extends Error {
  constructor() {
    super('Jumia authorization could not be decrypted');
    this.name = 'JumiaAuthorizationDecryptionError';
  }
}

function buildAuthorizationContext(
  merchantId: string,
  clientKeyHash: string
): string {
  return `${merchantId}:${clientKeyHash}`;
}

function decodeKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) {
    throw new Error('Jumia authorization encryption key must be 32 bytes');
  }
  return key;
}

function parseCiphertext(ciphertext: string): SerializedAuthorization {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(ciphertext, 'base64url').toString('utf8')
    );
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('v' in parsed) ||
      (parsed.v !== LEGACY_VERSION && parsed.v !== VERSION_WITH_AAD) ||
      !('iv' in parsed) ||
      typeof parsed.iv !== 'string' ||
      !('tag' in parsed) ||
      typeof parsed.tag !== 'string' ||
      !('data' in parsed) ||
      typeof parsed.data !== 'string'
    ) {
      throw new Error('invalid envelope');
    }
    return parsed as SerializedAuthorization;
  } catch {
    throw new JumiaAuthorizationDecryptionError();
  }
}

function encrypt(
  credentials: JumiaAuthorizationCredentials,
  encodedKey: string,
  context: string
): string {
  const key = decodeKey(encodedKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), 'utf8'),
    cipher.final(),
  ]);
  const envelope: SerializedAuthorization = {
    v: VERSION_WITH_AAD,
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: encrypted.toString('base64url'),
  };
  return Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url');
}

function decrypt(
  ciphertext: string,
  encodedKey: string,
  context?: string
): JumiaAuthorizationCredentials {
  const envelope = parseCiphertext(ciphertext);
  const key = decodeKey(encodedKey);
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(envelope.iv, 'base64url'),
      { authTagLength: AUTH_TAG_BYTES }
    );
    if (envelope.v === VERSION_WITH_AAD) {
      if (!context) {
        throw new Error('missing authorization context');
      }
      decipher.setAAD(Buffer.from(context, 'utf8'));
    }
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const parsed: unknown = JSON.parse(plaintext);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('clientId' in parsed) ||
      typeof parsed.clientId !== 'string' ||
      !('refreshToken' in parsed) ||
      typeof parsed.refreshToken !== 'string' ||
      !('accessToken' in parsed) ||
      typeof parsed.accessToken !== 'string'
    ) {
      throw new Error('invalid payload');
    }
    return parsed as JumiaAuthorizationCredentials;
  } catch {
    throw new JumiaAuthorizationDecryptionError();
  }
}

export const jumiaAuthorizationCrypto = {
  buildAuthorizationContext,
  encrypt,
  decrypt,
};

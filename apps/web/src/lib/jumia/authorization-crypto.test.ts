import { describe, expect, it } from 'vitest';
import {
  JumiaAuthorizationDecryptionError,
  jumiaAuthorizationCrypto,
} from '@/lib/jumia/authorization-crypto';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER_KEY = Buffer.alloc(32, 8).toString('base64');
const CONTEXT = jumiaAuthorizationCrypto.buildAuthorizationContext(
  '00000000-0000-4000-8000-000000000001',
  'a'.repeat(64)
);
const OTHER_CONTEXT = jumiaAuthorizationCrypto.buildAuthorizationContext(
  '00000000-0000-4000-8000-000000000002',
  'b'.repeat(64)
);
const CREDENTIALS = {
  clientId: 'merchant-client-id',
  refreshToken: 'merchant-refresh-token',
  accessToken: 'short-lived-access-token',
};

function flipFirstBase64UrlByte(value: string): string {
  const bytes = Buffer.from(value, 'base64url');
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return bytes.toString('base64url');
}

describe('Jumia authorization encryption', () => {
  it('round-trips credentials with authenticated encryption', () => {
    const ciphertext = jumiaAuthorizationCrypto.encrypt(
      CREDENTIALS,
      KEY,
      CONTEXT
    );

    expect(jumiaAuthorizationCrypto.decrypt(ciphertext, KEY, CONTEXT)).toEqual(
      CREDENTIALS
    );
  });

  it('uses a fresh nonce for every encryption', () => {
    expect(
      jumiaAuthorizationCrypto.encrypt(CREDENTIALS, KEY, CONTEXT)
    ).not.toBe(jumiaAuthorizationCrypto.encrypt(CREDENTIALS, KEY, CONTEXT));
  });

  it('does not include credential values in ciphertext', () => {
    const ciphertext = jumiaAuthorizationCrypto.encrypt(
      CREDENTIALS,
      KEY,
      CONTEXT
    );

    expect(ciphertext).not.toContain(CREDENTIALS.clientId);
    expect(ciphertext).not.toContain(CREDENTIALS.refreshToken);
    expect(ciphertext).not.toContain(CREDENTIALS.accessToken);
  });

  it('fails closed with the wrong key', () => {
    const ciphertext = jumiaAuthorizationCrypto.encrypt(
      CREDENTIALS,
      KEY,
      CONTEXT
    );

    expect(() =>
      jumiaAuthorizationCrypto.decrypt(ciphertext, OTHER_KEY, CONTEXT)
    ).toThrow('Jumia authorization could not be decrypted');
  });

  it('fails closed when ciphertext is transplanted to another owner context', () => {
    const ciphertext = jumiaAuthorizationCrypto.encrypt(
      CREDENTIALS,
      KEY,
      CONTEXT
    );

    expect(() =>
      jumiaAuthorizationCrypto.decrypt(ciphertext, KEY, OTHER_CONTEXT)
    ).toThrow('Jumia authorization could not be decrypted');
  });

  it('fails closed when ciphertext is tampered with', () => {
    const ciphertext = jumiaAuthorizationCrypto.encrypt(
      CREDENTIALS,
      KEY,
      CONTEXT
    );
    const envelope = JSON.parse(
      Buffer.from(ciphertext, 'base64url').toString('utf8')
    ) as { data: string };
    envelope.data = flipFirstBase64UrlByte(envelope.data);
    const tampered = Buffer.from(JSON.stringify(envelope), 'utf8').toString(
      'base64url'
    );

    expect(() =>
      jumiaAuthorizationCrypto.decrypt(tampered, KEY, CONTEXT)
    ).toThrow('Jumia authorization could not be decrypted');
  });

  it('fails closed when the authentication tag is tampered with', () => {
    const ciphertext = jumiaAuthorizationCrypto.encrypt(
      CREDENTIALS,
      KEY,
      CONTEXT
    );
    const envelope = JSON.parse(
      Buffer.from(ciphertext, 'base64url').toString('utf8')
    ) as { tag: string };
    envelope.tag = flipFirstBase64UrlByte(envelope.tag);
    const tampered = Buffer.from(JSON.stringify(envelope), 'utf8').toString(
      'base64url'
    );

    expect(() =>
      jumiaAuthorizationCrypto.decrypt(tampered, KEY, CONTEXT)
    ).toThrow('Jumia authorization could not be decrypted');
  });

  it('rejects an invalid encryption key without echoing it', () => {
    expect(() =>
      jumiaAuthorizationCrypto.encrypt(CREDENTIALS, '', CONTEXT)
    ).toThrow('Jumia authorization encryption key must be 32 bytes');
  });

  it('throws a typed error so callers can distinguish stale ciphertext', () => {
    const ciphertext = jumiaAuthorizationCrypto.encrypt(
      CREDENTIALS,
      KEY,
      CONTEXT
    );

    expect(() =>
      jumiaAuthorizationCrypto.decrypt(ciphertext, OTHER_KEY, CONTEXT)
    ).toThrow(JumiaAuthorizationDecryptionError);
  });

  it('keeps max-length credentials inside the ciphertext storage ceiling', () => {
    const ciphertext = jumiaAuthorizationCrypto.encrypt(
      {
        clientId: 'c'.repeat(512),
        refreshToken: 'r'.repeat(8192),
        accessToken: 'a'.repeat(8192),
      },
      KEY,
      CONTEXT
    );

    expect(ciphertext.length).toBeGreaterThanOrEqual(32);
    expect(ciphertext.length).toBeLessThanOrEqual(32768);
  });

  it('surfaces invalid encryption key errors separately from decryption failures', () => {
    const ciphertext = jumiaAuthorizationCrypto.encrypt(
      CREDENTIALS,
      KEY,
      CONTEXT
    );

    expect(() =>
      jumiaAuthorizationCrypto.decrypt(
        ciphertext,
        Buffer.alloc(16).toString('base64')
      )
    ).toThrow('Jumia authorization encryption key must be 32 bytes');
  });
});

// @vitest-environment node

import { generateKeyPairSync } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  challengeIssuer,
  challengePrivateKeyPem,
  challengePublicKeyPem,
  getFixedChatwootPlatformOrigin,
  normalizeHttpsOrigin,
  rsaModulusLength,
} from './commerce-context';
import {
  env,
  prepareChatwootCommerceContextCrypto,
} from './commerce-context.test-fixtures';

beforeAll(prepareChatwootCommerceContextCrypto);

describe('Chatwoot commerce context configuration', () => {
  it('normalizes secure origins and rejects non-origin URL forms', () => {
    expect(normalizeHttpsOrigin('https://SHOP.example.com:443/')).toBe(
      'https://shop.example.com'
    );

    for (const value of [
      'http://shop.example.com',
      'https://shop.example.com/catalog',
      'https://user:password@shop.example.com',
      'https://shop.example.com?next=/checkout',
      'https://shop.example.com#section',
      'not a URL',
      `https://${'a'.repeat(510)}`,
    ]) {
      expect(normalizeHttpsOrigin(value)).toBeNull();
    }
  });

  it('requires valid fixed origins and a sufficiently strong RSA key', () => {
    expect(challengeIssuer(env)).toBe('https://baci.example');
    expect(challengePrivateKeyPem(env)).toContain(
      '-----BEGIN PRIVATE KEY-----'
    );
    expect(challengePublicKeyPem(env)).toContain('-----BEGIN PUBLIC KEY-----');

    const validPlatformEnv = {
      ...env,
      EKAETTE_CHATWOOT_PLATFORM_ORIGIN: 'https://chatwoot.example',
    };
    expect(getFixedChatwootPlatformOrigin(validPlatformEnv)).toBe(
      'https://chatwoot.example'
    );
    expect(() =>
      getFixedChatwootPlatformOrigin({
        ...validPlatformEnv,
        EKAETTE_CHATWOOT_PLATFORM_ORIGIN: 'http://chatwoot.example',
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid_config' }));
    expect(() =>
      challengeIssuer({ ...env, EKAETTE_CHATWOOT_CHALLENGE_ISSUER: 'bad' })
    ).toThrowError(expect.objectContaining({ code: 'invalid_config' }));

    const weakKey = generateKeyPairSync('rsa', {
      modulusLength: 1024,
      privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
      publicKeyEncoding: { format: 'pem', type: 'spki' },
    }).privateKey;
    expect(() => rsaModulusLength(weakKey, true)).toThrowError(
      expect.objectContaining({ code: 'invalid_config' })
    );
    expect(() =>
      challengePrivateKeyPem({
        ...env,
        EKAETTE_CHATWOOT_CHALLENGE_PRIVATE_KEY: weakKey,
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid_config' }));
  });
});

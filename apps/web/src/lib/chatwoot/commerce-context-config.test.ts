// @vitest-environment node

import { generateKeyPairSync } from 'node:crypto';
import { exportSPKI } from 'jose';
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
  challengePublicKey,
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

const PUBLIC_KEY_VAR = 'EKAETTE_CHATWOOT_CHALLENGE_PUBLIC_KEY';
const PRIVATE_KEY_VAR = 'EKAETTE_CHATWOOT_CHALLENGE_PRIVATE_KEY';

function makeRsaPair(modulusLength = 2048) {
  return generateKeyPairSync('rsa', {
    modulusLength,
    privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    publicKeyEncoding: { format: 'pem', type: 'spki' },
  });
}

function trackEnvReads(source: NodeJS.ProcessEnv) {
  const reads: string[] = [];
  const proxy = new Proxy(source, {
    get(target, property, receiver) {
      if (typeof property === 'string') reads.push(property);
      return Reflect.get(target, property, receiver);
    },
  });
  return { proxy, reads };
}

describe('optional Chatwoot challenge public key', () => {
  it('returns the configured public key without reading the private key', () => {
    const configured = makeRsaPair();
    const otherPrivate = makeRsaPair().privateKey;
    const { proxy, reads } = trackEnvReads({
      ...env,
      [PUBLIC_KEY_VAR]: configured.publicKey,
      [PRIVATE_KEY_VAR]: otherPrivate,
    });

    expect(challengePublicKeyPem(proxy)).toBe(configured.publicKey);
    expect(reads).toContain(PUBLIC_KEY_VAR);
    expect(reads).not.toContain(PRIVATE_KEY_VAR);
  });

  it('works when the private key is absent from the environment entirely', () => {
    const configured = makeRsaPair();
    const { [PRIVATE_KEY_VAR]: _omitted, ...withoutPrivate } = env;

    expect(
      challengePublicKeyPem({
        ...withoutPrivate,
        [PUBLIC_KEY_VAR]: configured.publicKey,
      })
    ).toBe(configured.publicKey);
  });

  it('accepts a single-line value with literal backslash-n sequences', () => {
    const configured = makeRsaPair();
    const escaped = configured.publicKey.trim().replace(/\n/g, '\\n');

    expect(challengePublicKeyPem({ ...env, [PUBLIC_KEY_VAR]: escaped })).toBe(
      `${configured.publicKey.trim()}\n`
    );
  });

  it('derives the public key from the private key when no public key is set', async () => {
    const expected = await exportSPKI(challengePublicKey);

    expect(challengePublicKeyPem(env)).toBe(expected);
    expect(challengePublicKeyPem({ ...env, [PUBLIC_KEY_VAR]: '' })).toBe(
      expected
    );
    expect(challengePublicKeyPem({ ...env, [PUBLIC_KEY_VAR]: '   ' })).toBe(
      expected
    );
  });

  it('still requires the private key when no public key is set', () => {
    const { [PRIVATE_KEY_VAR]: _omitted, ...withoutPrivate } = env;

    expect(() => challengePublicKeyPem(withoutPrivate)).toThrowError(
      expect.objectContaining({ code: 'invalid_config' })
    );
  });

  it('rejects a malformed public key instead of falling back to the private key', () => {
    const rsa = makeRsaPair();
    const weak = makeRsaPair(1024).publicKey;
    const ec = generateKeyPairSync('ec', {
      namedCurve: 'P-256',
      publicKeyEncoding: { format: 'pem', type: 'spki' },
      privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
    }).publicKey;
    const garbage =
      '-----BEGIN PUBLIC KEY-----\nbm90IGEga2V5\n-----END PUBLIC KEY-----';

    for (const value of ['not-a-key', rsa.privateKey, garbage, weak, ec]) {
      expect(() =>
        challengePublicKeyPem({ ...env, [PUBLIC_KEY_VAR]: value })
      ).toThrowError(expect.objectContaining({ code: 'invalid_config' }));
    }
  });
});

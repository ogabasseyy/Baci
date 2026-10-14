import { describe, expect, it } from 'vitest';

import {
  buildHandoffContinueUrl,
  createHandoffToken,
  detectHandoffCaller,
  hashHandoffToken,
  isHandoffWebOriginAllowed,
  parseHandoffToken,
} from './handoff';

const SECRET = 'test-handoff-secret-min-32-chars!!!!';

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

const CART_ID = '22222222-2222-4222-8222-222222222222';

const TOKEN_INPUT = {
  cartId: CART_ID,
  destination: { type: 'web' as const },
  environment: 'test',
  merchantId: MERCHANT_ID,
  operationId: 'handoff-op-1',
  principalId: 'guest-origin',
};

describe('handoff tokens', () => {
  it('mints deterministic versioned tokens for identical input', () => {
    const first = createHandoffToken(TOKEN_INPUT, SECRET);
    const second = createHandoffToken(TOKEN_INPUT, SECRET);

    expect(first).toBe(second);
    expect(first.startsWith('ch1.')).toBe(true);
    expect(first.split('.')).toHaveLength(3);
  });

  it('round-trips through parse with the same secret and environment', () => {
    const token = createHandoffToken(TOKEN_INPUT, SECRET);

    expect(parseHandoffToken(token, SECRET, 'test')).toEqual({
      cartId: CART_ID,
      destination: { type: 'web' },
      merchantId: MERCHANT_ID,
      operationId: 'handoff-op-1',
      principalId: 'guest-origin',
    });
  });

  it('rejects tampered tokens, wrong secrets and foreign environments', () => {
    const token = createHandoffToken(TOKEN_INPUT, SECRET);
    const [version, payload, signature] = token.split('.');

    expect(
      parseHandoffToken(token, 'wrong-secret-min-32-chars!!!!!!!!!', 'test')
    ).toBeNull();
    expect(parseHandoffToken(token, SECRET, 'production')).toBeNull();
    expect(
      parseHandoffToken(`${version}.${payload}X.${signature}`, SECRET, 'test')
    ).toBeNull();
    expect(
      parseHandoffToken('cp1.payload.signature', SECRET, 'test')
    ).toBeNull();
    expect(parseHandoffToken('not-a-token', SECRET, 'test')).toBeNull();
  });

  it('hashes tokens to stable hex digests', () => {
    const token = createHandoffToken(TOKEN_INPUT, SECRET);
    const hash = hashHandoffToken(token);

    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashHandoffToken(token)).toBe(hash);
    expect(hashHandoffToken(`${token}X`)).not.toBe(hash);
  });
});

describe('buildHandoffContinueUrl', () => {
  it('keeps the pairing secret in the fragment, off access logs', () => {
    const url = buildHandoffContinueUrl(
      { customDomain: null, rootDomain: 'usebaci.com', slug: 'ogabassey' },
      'ch1.payload.signature',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );

    expect(url).toBe(
      'https://ogabassey.usebaci.com/cart#handoff=ch1.payload.signature&hid=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );
    const [base, fragment] = url.split('#');
    expect(base).not.toContain('ch1.');
    expect(fragment).toContain('handoff=');
  });

  it('prefers the merchant custom domain for the continuation host', () => {
    const url = buildHandoffContinueUrl(
      {
        customDomain: 'Shop.Example.com',
        rootDomain: 'usebaci.com',
        slug: 'ogabassey',
      },
      'ch1.payload.signature',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    );

    expect(url.startsWith('https://shop.example.com/cart#')).toBe(true);
  });
});

describe('handoff destination checks', () => {
  it('detects browser callers from http origins', () => {
    expect(detectHandoffCaller('https://ogabassey.usebaci.com')).toBe('web');
    expect(detectHandoffCaller('http://localhost:3000')).toBe('web');
    expect(detectHandoffCaller(null)).toBe('native');
    expect(detectHandoffCaller('capacitor://localhost')).toBe('native');
  });

  it('allows only the merchant approved web origins', () => {
    const merchant = {
      customDomain: 'shop.example.com',
      rootDomain: 'usebaci.com',
      slug: 'ogabassey',
    };

    expect(
      isHandoffWebOriginAllowed('https://ogabassey.usebaci.com', merchant)
    ).toBe(true);
    expect(
      isHandoffWebOriginAllowed('https://shop.example.com', merchant)
    ).toBe(true);
    expect(isHandoffWebOriginAllowed('https://usebaci.com', merchant)).toBe(
      true
    );
    expect(
      isHandoffWebOriginAllowed('https://evil.example.com', merchant)
    ).toBe(false);
    expect(isHandoffWebOriginAllowed(null, merchant)).toBe(false);
  });
});

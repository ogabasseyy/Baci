import { describe, expect, it } from 'vitest';
import { chatwootCartAddMutationRequestSchema as schema } from './chatwoot-cart-add-mutation-request';

const valid = {
  cartVersion: 12,
  conversationId: 905,
  productSlug: 'phone-13',
  requestId: 'add-request-01',
  sessionToken: 'signed-session-token',
  variantId: '44444444-4444-4444-8444-444444444444',
};

const ok = (value: unknown) => schema.safeParse(value).success;

describe('chatwootCartAddMutationRequestSchema', () => {
  it('accepts a complete request and a request without a variant', () => {
    expect(ok(valid)).toBe(true);
    const { variantId: _variantId, ...withoutVariant } = valid;
    expect(ok(withoutVariant)).toBe(true);
  });

  it('accepts a PostgreSQL UUID with legacy RFC bits', () => {
    expect(
      ok({ ...valid, variantId: '00000000-0000-0000-0000-000000000001' })
    ).toBe(true);
  });

  it.each([
    ['cartVersion', 0],
    ['cartVersion', -1],
    ['cartVersion', 1.5],
    ['cartVersion', '12'],
    ['cartVersion', Number.MAX_SAFE_INTEGER + 1],
    ['conversationId', 0],
    ['conversationId', -3],
    ['conversationId', 1.5],
    ['conversationId', '905'],
    ['conversationId', Number.MAX_SAFE_INTEGER + 1],
  ])('rejects %s = %j', (key, value) => {
    expect(ok({ ...valid, [key]: value })).toBe(false);
  });

  it('accepts the largest safe integer ids', () => {
    expect(
      ok({
        ...valid,
        cartVersion: Number.MAX_SAFE_INTEGER,
        conversationId: Number.MAX_SAFE_INTEGER,
      })
    ).toBe(true);
  });

  it('enforces the product slug length and character rules', () => {
    expect(ok({ ...valid, productSlug: 'a' })).toBe(true);
    expect(ok({ ...valid, productSlug: 'a'.repeat(160) })).toBe(true);
    expect(ok({ ...valid, productSlug: 'a_b-c_d' })).toBe(true);
    expect(ok({ ...valid, productSlug: '' })).toBe(false);
    expect(ok({ ...valid, productSlug: 'a'.repeat(161) })).toBe(false);
    for (const slug of ['-a', 'a-', 'a--b', 'a b', 'a/b', 'a.b', 'a%20b']) {
      expect(ok({ ...valid, productSlug: slug })).toBe(false);
    }
  });

  it('enforces the request id length and character rules', () => {
    expect(ok({ ...valid, requestId: 'a'.repeat(8) })).toBe(true);
    expect(ok({ ...valid, requestId: 'a'.repeat(80) })).toBe(true);
    expect(ok({ ...valid, requestId: 'a'.repeat(7) })).toBe(false);
    expect(ok({ ...valid, requestId: 'a'.repeat(81) })).toBe(false);
    expect(ok({ ...valid, requestId: 'add request' })).toBe(false);
    expect(ok({ ...valid, requestId: 'add.request1' })).toBe(false);
  });

  it('enforces the session token length bounds', () => {
    expect(ok({ ...valid, sessionToken: 'a' })).toBe(true);
    expect(ok({ ...valid, sessionToken: 'a'.repeat(12_000) })).toBe(true);
    expect(ok({ ...valid, sessionToken: '' })).toBe(false);
    expect(ok({ ...valid, sessionToken: 'a'.repeat(12_001) })).toBe(false);
  });

  it('rejects malformed variant ids', () => {
    expect(ok({ ...valid, variantId: 'not-a-uuid' })).toBe(false);
    expect(ok({ ...valid, variantId: null })).toBe(false);
  });

  it.each([
    'cartVersion',
    'conversationId',
    'productSlug',
    'requestId',
    'sessionToken',
  ])('requires %s', (key) => {
    const { [key]: _removed, ...rest } = valid as Record<string, unknown>;
    expect(ok(rest)).toBe(false);
  });

  it('rejects unknown keys (strict object)', () => {
    expect(ok({ ...valid, quantity: 2 })).toBe(false);
    expect(ok({ ...valid, merchantId: 'x' })).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(ok(null)).toBe(false);
    expect(ok('add')).toBe(false);
    expect(ok([valid])).toBe(false);
  });
});

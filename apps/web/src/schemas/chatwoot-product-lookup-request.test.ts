import { describe, expect, it } from 'vitest';
import { chatwootProductLookupRequestSchema as schema } from './chatwoot-product-lookup-request';

const valid = {
  conversationId: 905,
  requestId: 'product-0001',
  sessionToken: 'signed-session-token',
  slug: 'phone-15',
};
const ok = (value: unknown) => schema.safeParse(value).success;

describe('chatwootProductLookupRequestSchema', () => {
  it('accepts a complete request', () => {
    expect(ok(valid)).toBe(true);
  });

  it.each([
    0,
    -1,
    1.5,
    '905',
    null,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects conversation id %j', (value) => {
    expect(ok({ ...valid, conversationId: value })).toBe(false);
  });

  it('accepts the smallest and largest safe conversation ids', () => {
    expect(ok({ ...valid, conversationId: 1 })).toBe(true);
    expect(ok({ ...valid, conversationId: Number.MAX_SAFE_INTEGER })).toBe(
      true
    );
  });

  it('enforces the request id length and character rules', () => {
    expect(ok({ ...valid, requestId: 'a' })).toBe(true);
    expect(ok({ ...valid, requestId: 'a'.repeat(80) })).toBe(true);
    expect(ok({ ...valid, requestId: '' })).toBe(false);
    expect(ok({ ...valid, requestId: 'a'.repeat(81) })).toBe(false);
    expect(ok({ ...valid, requestId: 'has space' })).toBe(false);
    expect(ok({ ...valid, requestId: 'dots.not.ok' })).toBe(false);
  });

  it('enforces the session token length bounds', () => {
    expect(ok({ ...valid, sessionToken: 'a' })).toBe(true);
    expect(ok({ ...valid, sessionToken: 'a'.repeat(12_000) })).toBe(true);
    expect(ok({ ...valid, sessionToken: '' })).toBe(false);
    expect(ok({ ...valid, sessionToken: 'a'.repeat(12_001) })).toBe(false);
  });

  it('enforces the slug length and shape boundaries', () => {
    expect(ok({ ...valid, slug: 'a' })).toBe(true);
    expect(ok({ ...valid, slug: 'a'.repeat(200) })).toBe(true);
    expect(ok({ ...valid, slug: 'iphone-15.5-pro' })).toBe(true);
    expect(ok({ ...valid, slug: 'iphone_15-pro' })).toBe(true);
    expect(ok({ ...valid, slug: '' })).toBe(false);
    expect(ok({ ...valid, slug: 'a'.repeat(201) })).toBe(false);
    for (const slug of ['-a', 'a-', 'a--b', 'a b', 'a/b', 'a..b', '../x']) {
      expect(ok({ ...valid, slug })).toBe(false);
    }
  });

  it.each([
    'conversationId',
    'requestId',
    'sessionToken',
    'slug',
  ])('requires %s', (key) => {
    const { [key]: _removed, ...rest } = valid as Record<string, unknown>;
    expect(ok(rest)).toBe(false);
  });

  it('rejects unknown keys and non-objects (strict object)', () => {
    expect(ok({ ...valid, merchantId: 'x' })).toBe(false);
    expect(ok(null)).toBe(false);
    expect(ok([valid])).toBe(false);
  });
});

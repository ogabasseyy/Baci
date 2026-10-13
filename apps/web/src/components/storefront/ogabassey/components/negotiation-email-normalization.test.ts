import { describe, expect, it } from 'vitest';
import { normalizeOptionalEmail } from './negotiation-email-normalization';

describe('negotiation email normalization', () => {
  it('normalizes optional email addresses for storage', () => {
    expect(normalizeOptionalEmail('  Buyer@Example.COM  ')).toBe(
      'buyer@example.com'
    );
    expect(normalizeOptionalEmail('')).toBeNull();
  });

  it('rejects invalid or overlong email addresses', () => {
    expect(normalizeOptionalEmail('a@b@c.com')).toBeNull();
    expect(normalizeOptionalEmail(`${'a'.repeat(250)}@x.com`)).toBeNull();
  });
});

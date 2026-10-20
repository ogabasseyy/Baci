import { describe, expect, it } from 'vitest';
import { optionalVoucherTokenSchema } from './optional-voucher-token-schema';

describe('optional voucher token', () => {
  it.each([undefined, null, '', '   '])('treats %j as absent', (value) => {
    expect(optionalVoucherTokenSchema.parse(value)).toBeUndefined();
  });

  it('trims and keeps a present token', () => {
    expect(optionalVoucherTokenSchema.parse('  voucher-token-123  ')).toBe(
      'voucher-token-123'
    );
  });

  it('accepts a token at the 512-character boundary', () => {
    const token = 'v'.repeat(512);
    expect(optionalVoucherTokenSchema.parse(token)).toBe(token);
  });

  it('rejects a token past the 512-character boundary', () => {
    expect(() => optionalVoucherTokenSchema.parse('v'.repeat(513))).toThrow();
  });

  it.each([42, true, {}])('rejects non-string %j', (value) => {
    expect(() => optionalVoucherTokenSchema.parse(value)).toThrow();
  });
});

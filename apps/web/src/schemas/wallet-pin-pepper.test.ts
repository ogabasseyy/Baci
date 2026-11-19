import { describe, expect, it } from 'vitest';
import {
  walletPinPepperEnvSchema,
  walletPinPepperSchema,
} from './wallet-pin-pepper';

describe('walletPinPepperSchema', () => {
  it('trims and accepts 32 to 512 characters', () => {
    const base = 'abcdefghijklmnop';
    expect(walletPinPepperSchema.parse(`  ${base.repeat(2)}  `)).toBe(
      base.repeat(2)
    );
    expect(walletPinPepperSchema.parse(base.repeat(32))).toBe(base.repeat(32));
  });

  it.each([
    'p'.repeat(40),
    'ab'.repeat(20),
    '0123456789'.repeat(4).slice(0, 9).repeat(5),
  ])('rejects a long but low-entropy pepper (case %#)', (value) => {
    expect(walletPinPepperSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    'abcdefghijklmnop'.repeat(2).slice(0, 31),
    'abcdefghijklmnop'.repeat(33),
    '',
    7,
  ])('rejects an unusable pepper (case %#)', (value) => {
    expect(walletPinPepperSchema.safeParse(value).success).toBe(false);
  });
});

describe('walletPinPepperEnvSchema', () => {
  it.each([undefined, '', '   '])('treats %j as unset', (value) => {
    expect(walletPinPepperEnvSchema.parse(value)).toBeUndefined();
  });

  it('accepts a trimmed pepper', () => {
    expect(walletPinPepperEnvSchema.parse(` ${'abcdefghij'.repeat(4)} `)).toBe(
      'abcdefghij'.repeat(4)
    );
  });

  it.each([
    'short-secret-value',
    'abcdefghijklmnop'.repeat(33),
    'p'.repeat(40),
    7,
  ])('reads an unusable pepper as unset instead of failing (case %#)', (value) => {
    const result = walletPinPepperEnvSchema.safeParse(value);
    expect(result.success).toBe(true);
    expect(result.data).toBeUndefined();
  });

  it('keeps the request-time schema strict, with a message that never echoes the value', () => {
    const result = walletPinPepperSchema.safeParse('short-secret-value');
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain(
      'short-secret-value'
    );
    expect(result.error?.issues[0]?.message).toBe(
      'WALLET_PIN_PEPPER must be at least 32 characters'
    );
  });
});

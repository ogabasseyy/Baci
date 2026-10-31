import { describe, expect, it } from 'vitest';
import {
  walletPinPepperEnvSchema,
  walletPinPepperSchema,
} from './wallet-pin-pepper';

describe('walletPinPepperSchema', () => {
  it('trims and accepts 32 to 512 characters', () => {
    expect(walletPinPepperSchema.parse(`  ${'p'.repeat(32)}  `)).toBe(
      'p'.repeat(32)
    );
    expect(walletPinPepperSchema.parse('p'.repeat(512))).toBe('p'.repeat(512));
  });

  it.each([
    'p'.repeat(31),
    'p'.repeat(513),
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
    expect(walletPinPepperEnvSchema.parse(` ${'p'.repeat(40)} `)).toBe(
      'p'.repeat(40)
    );
  });

  it('rejects a short pepper with a message that never echoes it', () => {
    const result = walletPinPepperEnvSchema.safeParse('short-secret-value');
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain(
      'short-secret-value'
    );
    expect(result.error?.issues[0]?.message).toBe(
      'WALLET_PIN_PEPPER must be at least 32 characters'
    );
  });
});

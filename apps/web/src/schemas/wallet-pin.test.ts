import { describe, expect, it } from 'vitest';
import { walletPinSchemas } from './wallet-pin';

describe('walletPinSchemas requests', () => {
  it('accepts 4 to 6 digit PINs only', () => {
    for (const pin of ['1234', '12345', '123456'])
      expect(walletPinSchemas.setRequest.safeParse({ pin }).success).toBe(true);
    for (const pin of ['123', '1234567', '12a4', ' 1234', '', 1234, null])
      expect(walletPinSchemas.setRequest.safeParse({ pin }).success).toBe(
        false
      );
  });

  it('rejects unknown keys, including a body-selected tenant', () => {
    const merchantId = '11111111-1111-4111-8111-111111111111';
    expect(
      walletPinSchemas.setRequest.safeParse({ pin: '1234', merchantId }).success
    ).toBe(false);
    expect(
      walletPinSchemas.resetRequest.safeParse({ pin: '1234', userId: 'x' })
        .success
    ).toBe(false);
    expect(
      walletPinSchemas.changeRequest.safeParse({
        currentPin: '1234',
        newPin: '5678',
        merchantId,
      }).success
    ).toBe(false);
  });

  it('requires both PINs to change', () => {
    expect(
      walletPinSchemas.changeRequest.safeParse({
        currentPin: '1234',
        newPin: '5678',
      }).success
    ).toBe(true);
    expect(
      walletPinSchemas.changeRequest.safeParse({ currentPin: '1234' }).success
    ).toBe(false);
    expect(
      walletPinSchemas.changeRequest.safeParse({ newPin: '5678' }).success
    ).toBe(false);
  });

  it('never echoes the PIN in a validation message', () => {
    const result = walletPinSchemas.setRequest.safeParse({ pin: '98a7' });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('98a7');
  });
});

describe('walletPinSchemas database answers', () => {
  it('parses each state and refuses unknown shapes', () => {
    const salt = 'ab'.repeat(16);
    expect(
      walletPinSchemas.pinState.parse({
        status: 'set',
        kdfVersion: 1,
        salt,
        attemptsRemaining: 5,
      }).status
    ).toBe('set');
    expect(walletPinSchemas.pinState.parse({ status: 'not_set' }).status).toBe(
      'not_set'
    );
    expect(() => walletPinSchemas.pinState.parse({ status: 'set' })).toThrow();
    expect(() =>
      walletPinSchemas.pinState.parse({ status: 'other' })
    ).toThrow();
    expect(() => walletPinSchemas.pinState.parse(null)).toThrow();
  });

  it('parses mutation answers per operation', () => {
    expect(walletPinSchemas.setResult.parse({ status: 'set' }).status).toBe(
      'set'
    );
    expect(() =>
      walletPinSchemas.setResult.parse({ status: 'changed' })
    ).toThrow();
    expect(
      walletPinSchemas.changeResult.parse({
        status: 'incorrect',
        attemptsRemaining: 2,
      })
    ).toEqual({ status: 'incorrect', attemptsRemaining: 2 });
    expect(() =>
      walletPinSchemas.changeResult.parse({ status: 'incorrect' })
    ).toThrow();
    expect(walletPinSchemas.resetResult.parse({ status: 'reset' }).status).toBe(
      'reset'
    );
    expect(() => walletPinSchemas.resetResult.parse(undefined)).toThrow();
  });
});

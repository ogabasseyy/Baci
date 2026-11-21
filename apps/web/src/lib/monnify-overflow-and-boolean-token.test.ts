import { describe, expect, it } from 'vitest';
import { readMonnifyBillToken } from './monnify-bills-status';
import {
  hasMonnifyAuthOrThrottleCode,
  hasMonnifyNonDefinitiveCode,
} from './monnify-non-definitive-code';

function nest(depth: number, leaf: Record<string, unknown>) {
  let value: Record<string, unknown> = leaf;
  for (let i = 0; i < depth; i++) {
    value = { nested: value };
  }
  return value;
}

describe('bugfix: depth overflow is not an auth/throttle match', () => {
  it('does not report an auth code for a body nested too deeply to scan', () => {
    expect(hasMonnifyAuthOrThrottleCode(nest(12, { note: 'x' }))).toBe(false);
  });

  it('still fails closed for the open-code scan', () => {
    expect(hasMonnifyNonDefinitiveCode(nest(12, { note: 'x' }))).toBe(true);
  });

  it('still finds a shallow auth code', () => {
    expect(
      hasMonnifyAuthOrThrottleCode({ responseBody: { statusCode: 401 } })
    ).toBe(true);
  });
});

describe('bugfix: serialized boolean and empty sentinels are not a token', () => {
  it.each([
    'false',
    'FALSE',
    'true',
    'NaN',
    'empty',
    'blank',
    'void',
  ])('ignores %j', (token) => {
    expect(readMonnifyBillToken({ token })).toBeUndefined();
  });

  it('keeps a real token', () => {
    expect(readMonnifyBillToken({ token: '3772-0340-4164' })).toBe(
      '3772-0340-4164'
    );
  });
});

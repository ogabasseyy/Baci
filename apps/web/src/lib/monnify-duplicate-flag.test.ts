import { describe, expect, it } from 'vitest';
import { hasMonnifyDuplicateFlag } from './monnify-duplicate-flag';

describe('hasMonnifyDuplicateFlag', () => {
  it.each([
    { duplicate: true },
    { duplicate: [true], message: 'Insufficient wallet balance' },
    { alreadyDelivered: true },
    { responseBody: { already_vended: 'yes' } },
    { responseBody: { is_duplicate: 'true' } },
    { responseBody: { idempotencyReplay: 1 } },
    { REFERENCE_ALREADY_EXISTS: 'Y' },
    { responseBody: [{ duplicateReference: 'MFBP-1' }] },
  ])('sees a set duplicate flag in %j', (answer) => {
    expect(hasMonnifyDuplicateFlag(answer)).toBe(true);
  });

  it.each([
    null,
    'duplicate',
    { duplicate: false },
    { responseBody: { is_duplicate: 'false' } },
    { responseBody: { duplicate: 0, reason: 'Insufficient wallet balance' } },
  ])('sees no set duplicate flag in %j', (answer) => {
    expect(hasMonnifyDuplicateFlag(answer)).toBe(false);
  });
});

describe('bugfix: nesting past the scan depth fails closed', () => {
  it('treats an over-deep answer as a possible duplicate', () => {
    expect(
      hasMonnifyDuplicateFlag({
        a: {
          b: { c: { d: { e: { f: { g: { h: { responseCode: '01' } } } } } } },
        },
      })
    ).toBe(true);
  });
});

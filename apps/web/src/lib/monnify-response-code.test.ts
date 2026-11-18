import { describe, expect, it } from 'vitest';
import { readMonnifyResponseCode } from './monnify-response-code';

describe('readMonnifyResponseCode', () => {
  it.each([
    [{ responseCode: '99' }, '99'],
    [{ responseCode: 99 }, '99'],
    [{ responseCode: ' D02 ' }, 'D02'],
    [{ responseCode: 'MP_001' }, 'MP_001'],
    [{ responseCode: 'DUPLICATE_REFERENCE' }, 'DUPLICATE_REFERENCE'],
  ])('reads the code from %j', (answer, expected) => {
    expect(readMonnifyResponseCode(answer)).toBe(expected);
  });

  it.each([
    null,
    'Insufficient funds',
    [],
    {},
    { responseCode: null },
    { responseCode: true },
    { responseCode: Number.NaN },
    { responseCode: Number.POSITIVE_INFINITY },
    { responseCode: '' },
    { responseCode: '0803 123 4567' },
    { responseCode: '08031234567' },
    { responseCode: 8031234567 },
    { responseCode: '801-234-5678' },
    { responseCode: '415-555-0132' },
    { responseCode: '12_34_5' },
    { responseCode: 'Bearer abcdefghijklmnopqrstuvwxyz' },
    { responseCode: 'aB3dE5gH7jK9mN' },
    { responseCode: 'DUPLICATE_REFERENCE_12345' },
    { responseCode: `A_${'B'.repeat(40)}` },
    { responseBody: { responseCode: '99' } },
  ])('returns undefined for %j', (answer) => {
    expect(readMonnifyResponseCode(answer)).toBeUndefined();
  });
});

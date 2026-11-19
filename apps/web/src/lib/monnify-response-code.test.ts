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
    { responseCode: '-' },
    { responseCode: '_' },
    { responseCode: 'aB3dE5gH7jK' },
    { responseCode: 'John_Doe123' },
    { responseCode: 'd02' },
    { responseCode: 'ALICE' },
    { responseCode: 'JOHN_DOE' },
    { responseCode: 'JANE-DOE' },
    { responseCode: 'UNKNOWN_TEXT_CODE' },
    [{ responseCode: '99' }, { responseCode: '01' }],
  ])('returns undefined for %j', (answer) => {
    expect(readMonnifyResponseCode(answer)).toBeUndefined();
  });
});

describe('bugfix: form-encoded answers with nested fields keep the code', () => {
  it('reads the single top-level code from the array form', () => {
    expect(
      readMonnifyResponseCode([
        { responseCode: '99' },
        { responseBody: { transactionStatus: 'FAILED' } },
      ])
    ).toBe('99');
  });
});

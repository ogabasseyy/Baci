import { describe, expect, it } from 'vitest';
import { hasMonnifyNonDefinitiveCode } from './monnify-non-definitive-code';

describe('hasMonnifyNonDefinitiveCode', () => {
  it.each([
    { responseCode: '409' },
    { responseCode: '01', responseBody: { responseCode: '429' } },
    { responseBody: { data: { error_code: 408 } } },
    { responseBody: [{ code: '099' }] },
    { status: 408, message: 'Insufficient wallet balance' },
    { statusCode: '429' },
    { status: 503, message: 'Insufficient wallet balance' },
    { responseStatus: 503, message: 'Insufficient wallet balance' },
    { status: 202, message: 'Insufficient wallet balance' },
    { responseCode: '0', message: 'Insufficient wallet balance' },
    { responseCode: '401', message: 'Insufficient wallet balance' },
    { responseBody: { responseCode: ['99'] } },
    { responseBody: { responseCode: 403 } },
    { responseBody: { responseCode: '500' } },
  ])('finds a non-definitive code in %j', (answer) => {
    expect(hasMonnifyNonDefinitiveCode(answer)).toBe(true);
  });

  it.each([
    null,
    'text',
    { responseCode: '01' },
    { responseBody: { productCode: '409' } },
    { responseBody: { amount: 429 } },
    { status: 400 },
  ])('finds none in %j', (answer) => {
    expect(hasMonnifyNonDefinitiveCode(answer)).toBe(false);
  });
});

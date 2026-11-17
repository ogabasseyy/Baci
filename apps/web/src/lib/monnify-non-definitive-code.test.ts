import { describe, expect, it } from 'vitest';
import { hasMonnifyNonDefinitiveCode } from './monnify-non-definitive-code';

describe('hasMonnifyNonDefinitiveCode', () => {
  it.each([
    { responseCode: '409' },
    { responseCode: '01', responseBody: { responseCode: '429' } },
    { responseBody: { data: { error_code: 408 } } },
    { responseBody: [{ code: '099' }] },
  ])('finds a non-definitive code in %j', (answer) => {
    expect(hasMonnifyNonDefinitiveCode(answer)).toBe(true);
  });

  it.each([
    null,
    'text',
    { responseCode: '01' },
    { responseBody: { productCode: '409' } },
    { responseBody: { amount: 429 } },
  ])('finds none in %j', (answer) => {
    expect(hasMonnifyNonDefinitiveCode(answer)).toBe(false);
  });
});

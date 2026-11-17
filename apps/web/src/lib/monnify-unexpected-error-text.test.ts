import { describe, expect, it } from 'vitest';
import { reportsMonnifyUnexpectedError } from './monnify-unexpected-error-text';

describe('reportsMonnifyUnexpectedError', () => {
  it.each([
    JSON.stringify({ responseCode: '99', responseMessage: 'x' }),
    JSON.stringify({ responseCode: 99 }),
    JSON.stringify({ responseCode: ' 099 ' }),
    'Code 99: Insufficient wallet balance',
    'response_code=99',
    'errorCode: 99',
    JSON.stringify({
      responseCode: '01',
      responseBody: { responseCode: '99' },
    }),
  ])('reads %s as code 99', (text) => {
    expect(reportsMonnifyUnexpectedError(text)).toBe(true);
  });

  it.each([
    JSON.stringify({ responseCode: '01', responseMessage: 'Low balance' }),
    'Code 199',
    JSON.stringify({ responseCode: '01', responseBody: { productCode: '99' } }),
    'billerCode=99',
    'Insufficient wallet balance',
    '',
    null,
  ])('does not read %s as code 99', (text) => {
    expect(reportsMonnifyUnexpectedError(text)).toBe(false);
  });
});

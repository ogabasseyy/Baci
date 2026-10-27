import { describe, expect, it } from 'vitest';
import { isExplicitUnsupportedSavingsDateFilterError } from './primary-wallet-savings-identity-date-filter-error';

describe('unsupported PiggyVest savings date-filter detection', () => {
  it.each([
    400, 422,
  ])('recognizes an explicit unsupported date filter at HTTP %i', (httpStatus) => {
    const error = Object.assign(new Error('PROVIDER_HTTP_ERROR'), {
      httpStatus,
      responseBody: { message: 'start_date is not supported' },
    });

    expect(isExplicitUnsupportedSavingsDateFilterError(error)).toBe(true);
  });

  it.each([
    Object.assign(new Error('PROVIDER_HTTP_ERROR'), {
      httpStatus: 500,
      responseBody: { message: 'start_date is not supported' },
    }),
    Object.assign(new Error('PROVIDER_HTTP_ERROR'), {
      httpStatus: 400,
      responseBody: { message: 'wallet is not supported' },
    }),
    Object.assign(new Error('PROVIDER_HTTP_ERROR'), {
      httpStatus: 400,
      responseBody: { message: 'start_date is invalid' },
    }),
    new Error('different error'),
    'start_date is not supported',
  ])('does not treat unrelated or ambiguous errors as unsupported date filters', (error) => {
    expect(isExplicitUnsupportedSavingsDateFilterError(error)).toBe(false);
  });
});

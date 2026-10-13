import { describe, expect, it } from 'vitest';
import { parseGenerateDvaResponse } from './parse-generate-dva-response';

describe('parseGenerateDvaResponse', () => {
  it('returns a valid virtual account payload', () => {
    const payload = {
      virtualAccount: {
        account_number: '1234567890',
        bank_name: 'Paystack-Titan',
      },
    };

    expect(parseGenerateDvaResponse(payload)).toEqual(payload);
  });

  it.each([
    null,
    [],
    {},
    { virtualAccount: [] },
    { virtualAccount: 'bad' },
    { virtualAccount: { account_number: 123 } },
    { virtualAccount: { bank_name: false } },
  ])('rejects malformed payload %#', (payload) => {
    expect(parseGenerateDvaResponse(payload)).toBeNull();
  });
});

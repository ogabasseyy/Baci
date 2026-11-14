import { PiggyvestPrimarySavingsSchemas } from './piggyvest-primary-savings';

// The request a legacy-bound or server-off app builds is unchanged: the PIN
// proof is optional and absent unless the server asked for one.
describe('server keeps PiggyVest off', () => {
  const base = {
    merchantId: '11111111-1111-4111-8111-111111111111',
    goalId: '22222222-2222-4222-8222-222222222222',
    operationId: '33333333-3333-4333-8333-333333333333',
    amountKobo: 2000,
  };

  it('accepts the request without a PIN proof, exactly as before', () => {
    const parsed = PiggyvestPrimarySavingsSchemas.request.parse(base);
    expect(parsed).toEqual(base);
  });

  it('still refuses unknown fields', () => {
    expect(
      PiggyvestPrimarySavingsSchemas.request.safeParse({ ...base, extra: 1 })
        .success
    ).toBe(false);
  });
});

import { SavingsPlanFundingResponseSchema } from './customer-savings';

// A server that keeps PiggyVest off never returns a ready plan account, and
// a stalled-setup flag can only ride on a pending plan answer the app would
// read as "still being set up" without the primary verdict.
describe('server keeps PiggyVest off', () => {
  it('keeps the retry flag optional, so a plain pending answer stays valid', () => {
    expect(
      SavingsPlanFundingResponseSchema.safeParse({ status: 'pending' }).success
    ).toBe(true);
    expect(
      SavingsPlanFundingResponseSchema.parse({
        status: 'pending',
        setupRetryable: true,
      }).setupRetryable
    ).toBe(true);
  });

  it('rejects a non-boolean retry flag', () => {
    expect(
      SavingsPlanFundingResponseSchema.safeParse({
        status: 'pending',
        setupRetryable: 'yes',
      }).success
    ).toBe(false);
  });
});

import { PrimarySavingsPlanFundingSchemas as schemas } from './primary-savings-plan-funding';

// A server that keeps PiggyVest off never answers with a ready plan account,
// and the setup request carries no default interest answer.
describe('server keeps PiggyVest off', () => {
  const selection = {
    merchantId: '11111111-1111-4111-8111-111111111111',
    goalId: '22222222-2222-4222-8222-222222222222',
  };

  it('requires an explicit boolean interest answer for setup', () => {
    for (const interestAccepted of [undefined, null, 'true', 1])
      expect(
        schemas.setupRequest.safeParse({ ...selection, interestAccepted })
          .success
      ).toBe(false);
    expect(
      schemas.setupRequest.safeParse({ ...selection, interestAccepted: false })
        .success
    ).toBe(true);
  });

  it('rejects a ready answer that carries no account', () => {
    expect(
      schemas.response.safeParse({ goalId: selection.goalId, status: 'ready' })
        .success
    ).toBe(false);
  });
});

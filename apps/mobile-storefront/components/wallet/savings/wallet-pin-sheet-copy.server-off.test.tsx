import {
  approvingLine,
  COPY,
  contextLine,
  requestKey,
} from './wallet-pin-sheet-copy';

const fund = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  goalId: '22222222-2222-4222-8222-222222222222',
  operationId: '33333333-3333-4333-8333-333333333333',
  amountKobo: 10000,
};

// Pure copy: no server call, so it reads the same with PiggyVest on or off.
describe('wallet PIN sheet copy', () => {
  it('says what a new PIN is approving, never naming a provider', () => {
    expect(approvingLine(fund)).toBe('Saving your PIN and approving ₦100…');
    expect(
      approvingLine({
        action: 'cancel',
        merchantId: fund.merchantId,
        goalId: fund.goalId,
        operationId: fund.operationId,
        goalTitle: 'iPhone',
      })
    ).toBe('Saving your PIN…');
    expect(approvingLine(null)).toBe('Saving your PIN…');
    expect(COPY.approving.title).not.toMatch(/piggy|paystack/i);
  });

  it('names what the PIN is for and keys each request', () => {
    expect(contextLine(fund)).toBe('Adding ₦100 to savings');
    expect(contextLine(null)).toBeNull();
    expect(requestKey(null)).toBe('closed');
    expect(requestKey(fund)).toContain(fund.operationId);
  });
});

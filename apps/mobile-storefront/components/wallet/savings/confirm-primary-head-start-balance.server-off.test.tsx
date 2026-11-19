import { confirmPrimaryHeadStartBalance } from './confirm-primary-head-start-balance';
import {
  PRIMARY_BALANCE_CHECK_FAILED_MESSAGE,
  PRIMARY_HEAD_START_SHORT_MESSAGE,
  readFreshPrimaryBalanceKobo,
} from './start-savings-wallet-balance';

jest.mock('./start-savings-wallet-balance', () => ({
  ...jest.requireActual<object>('./start-savings-wallet-balance'),
  readFreshPrimaryBalanceKobo: jest.fn(),
}));

const readBalance = jest.mocked(readFreshPrimaryBalanceKobo);
const input = {
  activeMerchantId: 'merchant-1',
  effectiveInitialContribution: 5000,
  targetValue: 100_000,
};

beforeEach(() => readBalance.mockReset());

// With PiggyVest switched off the balance read fails or answers nothing:
// the head start is never treated as covered.
describe('confirmPrimaryHeadStartBalance with PiggyVest off', () => {
  it('refuses when the balance read fails', async () => {
    readBalance.mockRejectedValue(new Error('PIGGYVEST_NOT_READY'));
    await expect(confirmPrimaryHeadStartBalance(input)).resolves.toBe(
      PRIMARY_BALANCE_CHECK_FAILED_MESSAGE
    );
  });

  it('refuses when there is no balance', async () => {
    readBalance.mockResolvedValue(null);
    await expect(confirmPrimaryHeadStartBalance(input)).resolves.toBe(
      PRIMARY_BALANCE_CHECK_FAILED_MESSAGE
    );
  });

  it('refuses a balance below the head start, and passes one that covers it', async () => {
    readBalance.mockResolvedValueOnce(499_999);
    await expect(confirmPrimaryHeadStartBalance(input)).resolves.toBe(
      PRIMARY_HEAD_START_SHORT_MESSAGE
    );
    readBalance.mockResolvedValueOnce(500_000);
    await expect(confirmPrimaryHeadStartBalance(input)).resolves.toBeNull();
  });

  it('refuses a head start above the target without reading the balance', async () => {
    const refusal = await confirmPrimaryHeadStartBalance({
      ...input,
      effectiveInitialContribution: 200_000,
    });
    expect(refusal).toEqual(expect.any(String));
    expect(readBalance).not.toHaveBeenCalled();
  });
});

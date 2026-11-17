import {
  PRIMARY_BALANCE_CHECK_FAILED_MESSAGE,
  PRIMARY_HEAD_START_SHORT_MESSAGE,
  primaryHeadStartRefusal,
  readFreshPrimaryBalanceKobo,
  wholeNairaHeadStart,
} from './start-savings-wallet-balance';

/**
 * Checks a fresh PiggyVest balance covers the head start before a plan is
 * created. Resolves the message to show, or null when it is covered. A
 * thrown read counts as unconfirmed.
 */
export async function confirmPrimaryHeadStartBalance(input: {
  activeMerchantId?: string;
  effectiveInitialContribution: number;
  targetValue: number;
}): Promise<string | null> {
  const headStartRefusal = primaryHeadStartRefusal(
    input.effectiveInitialContribution,
    input.targetValue
  );
  if (headStartRefusal) return headStartRefusal;
  let balanceKobo: number | null = null;
  try {
    balanceKobo = await readFreshPrimaryBalanceKobo(input.activeMerchantId);
  } catch {
    balanceKobo = null;
  }
  // The wallet's Add to savings sheet moves whole naira, rounding the
  // prefilled amount up: check the amount that will actually move.
  const headStartKobo =
    wholeNairaHeadStart(input.effectiveInitialContribution) * 100;
  if (balanceKobo === null) return PRIMARY_BALANCE_CHECK_FAILED_MESSAGE;
  return balanceKobo < headStartKobo ? PRIMARY_HEAD_START_SHORT_MESSAGE : null;
}

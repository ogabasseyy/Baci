import { act, renderHook } from '@testing-library/react-native';
import { WALLET_HISTORY_PAGE_SIZE } from '@/constants/wallet-history';
import { sanitizeWalletReturnTo } from '@/lib/sanitize-wallet-return-to';
import { mergeSavingsHistory } from './merge-savings-history';
import { useWalletCreditWatch } from './use-wallet-credit-watch';
import { topUp } from './use-wallet-credit-watch.test-support';
import type { Transaction } from './wallet-query';

jest.mock('@/constants/wallet-funding', () => ({
  WALLET_FUNDING_CHECKING_STATE_ENABLED: true,
  WALLET_FUNDING_POLLING: { INTERVAL_MS: 5000, TIMEOUT_MS: 120000 },
}));
jest.mock('@/lib/wallet-funding-session', () => ({
  anchorWalletFundingSession: jest.fn(),
  clearWalletFundingSession: jest.fn(),
  readWalletFundingSession: jest.fn(),
}));

const oldCredit: Transaction = {
  ...topUp('old-bank-credit', 1000, '2026-07-01T09:00:00.000Z'),
  type: 'credit',
  description: 'Previous bank transfer',
};
const newCredit: Transaction = {
  ...topUp('new-bank-credit', 2500, '2026-07-13T09:00:00.000Z'),
  type: 'credit',
  description: 'Bank transfer received',
};
const newerInterest = Array.from(
  { length: WALLET_HISTORY_PAGE_SIZE },
  (_, index): Transaction => ({
    id: `interest-${index}`,
    amount: 2,
    created_at: `2026-07-14T09:00:${String(index).padStart(2, '0')}.000Z`,
    description: 'Savings interest credited',
    source_type: 'savings_interest',
    type: 'credit',
  })
);
const returnTo = sanitizeWalletReturnTo('/utilities/airtime?repeatAmount=1000');

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

it.each([
  'before',
  'after',
] as const)('confirms a bank credit arriving %s the transferred action behind twenty newer interest rows', (arrival) => {
  const refetch = jest.fn();
  const initialLedger = arrival === 'after' ? [] : [oldCredit];
  const fundedLedger = [newCredit, ...initialLedger];
  const { result, rerender } = renderHook(
    ({ ledger }: { ledger: Transaction[] }) => {
      const history = mergeSavingsHistory(ledger, newerInterest);
      return useWalletCreditWatch({
        refetch,
        returnTo,
        transactions: history.filter(
          (row): row is Transaction & { amount: number } => row.amount !== null
        ),
      });
    },
    { initialProps: { ledger: initialLedger } }
  );
  expect(result.current.status).toBe('idle');
  expect(result.current.returnCtaHref).toBeUndefined();

  if (arrival === 'before') {
    rerender({ ledger: fundedLedger });
  }
  act(() => result.current.armCheck());
  if (arrival === 'after') {
    // Only savings-interest credits are present; they cannot confirm funding
    // or expose a purchase-return action.
    expect(result.current.status).toBe('checking');
    expect(result.current.creditedAmount).toBeNull();
    expect(result.current.returnCtaHref).toBeUndefined();
    rerender({ ledger: fundedLedger });
  }

  expect(result.current.status).toBe('credited');
  expect(result.current.creditedAmount).toBe(2500);
  expect(result.current.returnCtaHref).toBe(
    '/utilities/airtime?repeatAmount=1000'
  );
  expect(refetch).toHaveBeenCalledTimes(1);
});

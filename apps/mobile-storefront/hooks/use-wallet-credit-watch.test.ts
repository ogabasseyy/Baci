import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type {
  WalletFundingSession,
  WalletLedgerPosition,
} from '@/lib/wallet-funding-session';

let mockFlagEnabled = true;

jest.mock('@/constants/wallet-funding', () => ({
  get WALLET_FUNDING_CHECKING_STATE_ENABLED() {
    return mockFlagEnabled;
  },
  WALLET_FUNDING_POLLING: { INTERVAL_MS: 5000, TIMEOUT_MS: 120000 },
}));

const mockReadSession =
  jest.fn<(customerId: string) => Promise<WalletFundingSession | null>>();
const mockAnchorSession =
  jest.fn<
    (
      session: WalletFundingSession,
      position: WalletLedgerPosition | null
    ) => Promise<WalletFundingSession | null>
  >();
const mockClearSession = jest.fn<(customerId: string) => Promise<void>>();

// Indirection so the factory (hoisted above these consts) resolves the spies
// lazily, at call time. The real `resolve-wallet-credit-baseline` runs on top of
// these, so the anchor capture is exercised end to end.
jest.mock('@/lib/wallet-funding-session', () => ({
  anchorWalletFundingSession: (
    session: WalletFundingSession,
    position: WalletLedgerPosition | null
  ) => mockAnchorSession(session, position),
  clearWalletFundingSession: (customerId: string) =>
    mockClearSession(customerId),
  readWalletFundingSession: (customerId: string) => mockReadSession(customerId),
}));

import { WALLET_FUNDING_POLLING } from '@/constants/wallet-funding';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { useWalletCreditWatch } from './use-wallet-credit-watch';
import type { WalletTopUpCandidate } from './wallet-top-up-credit';

const RETURN_TO = '/utilities/airtime?repeatAmount=1000' as WalletReturnHref;

function topUp(
  id: string,
  amount: number,
  createdAt: string
): WalletTopUpCandidate {
  return {
    amount,
    created_at: createdAt,
    id,
    source_type: 'wallet_topup',
    type: 'credit',
  };
}

function positionOf(transaction: WalletTopUpCandidate): WalletLedgerPosition {
  if (transaction.created_at === null) {
    throw new Error('Wallet credit watch fixtures need a dated top-up');
  }
  return {
    createdAt: Date.parse(transaction.created_at),
    id: transaction.id,
  };
}

const OLD_TOP_UP = topUp('tx-old', 1000, '2026-07-01T09:00:00.000Z');
const NEW_TOP_UP = topUp('tx-new', 2500, '2026-07-13T09:00:00.000Z');
const LATER_TOP_UP = topUp('tx-later', 500, '2026-07-13T10:00:00.000Z');
const CASHBACK: WalletTopUpCandidate = {
  amount: 4000,
  created_at: '2026-07-13T08:30:00.000Z',
  id: 'tx-cashback',
  source_type: 'vtu_transaction',
  type: 'cashback',
};
const REVERSAL_CREDIT: WalletTopUpCandidate = {
  amount: 7000,
  created_at: '2026-07-13T08:45:00.000Z',
  id: 'tx-reversal',
  source_type: 'order_reversal',
  type: 'credit',
};

type Props = { transactions: readonly WalletTopUpCandidate[] | undefined };

describe('useWalletCreditWatch', () => {
  beforeEach(() => {
    mockFlagEnabled = true;
    mockReadSession.mockReset();
    mockAnchorSession.mockReset();
    mockClearSession.mockReset();
    mockReadSession.mockResolvedValue(null);
    mockAnchorSession.mockResolvedValue(null);
    mockClearSession.mockResolvedValue(undefined);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('starts idle and exposes no CTA before arming', () => {
    const { result } = renderHook(() =>
      useWalletCreditWatch({ refetch: jest.fn(), transactions: [OLD_TOP_UP] })
    );

    expect(result.current.status).toBe('idle');
    expect(result.current.creditedAmount).toBeNull();
    expect(result.current.returnCtaHref).toBeUndefined();
  });

  it('detects a top-up that landed BEFORE the customer tapped (pre-arm snapshot)', () => {
    const refetch = jest.fn();
    const { result, rerender } = renderHook(
      ({ transactions }: Props) =>
        useWalletCreditWatch({ refetch, returnTo: RETURN_TO, transactions }),
      { initialProps: { transactions: [OLD_TOP_UP] } as Props }
    );

    // The customer transfers from their bank app; realtime credits the wallet
    // while the app is backgrounded — BEFORE they tap "I've transferred".
    rerender({ transactions: [NEW_TOP_UP, OLD_TOP_UP] });

    act(() => {
      result.current.armCheck();
    });

    // The idle snapshot (tx-old) survives as the baseline, so the pre-tap
    // top-up reads as an immediate hit instead of timing out.
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(2500);
    expect(result.current.returnCtaHref).toBe(RETURN_TO);
  });

  it('ignores cashback and reversal credits that land while idle', () => {
    const refetch = jest.fn();
    const { result, rerender } = renderHook(
      ({ transactions }: Props) =>
        useWalletCreditWatch({ refetch, transactions }),
      { initialProps: { transactions: [OLD_TOP_UP] } as Props }
    );

    // Unrelated balance-raising ledger rows arrive while the panel is idle:
    // VTU cashback and an order reversal both credit the spendable balance.
    rerender({ transactions: [REVERSAL_CREDIT, CASHBACK, OLD_TOP_UP] });

    act(() => {
      result.current.armCheck();
    });

    // Neither is a bank transfer, so the watch keeps waiting instead of sending
    // the customer back to a purchase they still cannot afford.
    expect(result.current.status).toBe('checking');
    expect(result.current.creditedAmount).toBeNull();
    expect(result.current.returnCtaHref).toBeUndefined();

    // The real transfer landing afterwards still credits, with the top-up's own
    // amount (2500) rather than a balance delta polluted by the cashback.
    rerender({
      transactions: [NEW_TOP_UP, REVERSAL_CREDIT, CASHBACK, OLD_TOP_UP],
    });
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(2500);
  });

  it('resets to idle and can arm a fresh check for a second transfer', () => {
    const refetch = jest.fn();
    const { result, rerender } = renderHook(
      ({ transactions }: Props) =>
        useWalletCreditWatch({ refetch, transactions }),
      { initialProps: { transactions: [OLD_TOP_UP] } as Props }
    );

    act(() => {
      result.current.armCheck();
    });
    rerender({ transactions: [NEW_TOP_UP, OLD_TOP_UP] });
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(2500);

    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.creditedAmount).toBeNull();

    // The second cycle baselines on the acknowledged top-up (tx-new).
    act(() => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('checking');
    rerender({ transactions: [LATER_TOP_UP, NEW_TOP_UP, OLD_TOP_UP] });
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(500);
  });

  it('refuses to arm while the wallet ledger is still loading', () => {
    const refetch = jest.fn();
    const { result, rerender } = renderHook(
      ({ transactions }: Props) =>
        useWalletCreditWatch({ refetch, transactions }),
      { initialProps: { transactions: undefined } as Props }
    );

    act(() => {
      result.current.armCheck();
    });

    // No baseline exists yet, so arming is a no-op...
    expect(result.current.status).toBe('idle');
    expect(refetch).not.toHaveBeenCalled();

    // ...and the customer's pre-existing top-up history loading in later must
    // NOT read as a fresh credit.
    rerender({ transactions: [OLD_TOP_UP] });
    expect(result.current.status).toBe('idle');
    expect(result.current.creditedAmount).toBeNull();
  });

  it('moves idle → checking on arm and credited when the top-up lands', () => {
    const refetch = jest.fn();
    const { result, rerender } = renderHook(
      ({ transactions }: Props) =>
        useWalletCreditWatch({ refetch, returnTo: RETURN_TO, transactions }),
      { initialProps: { transactions: [] } as Props }
    );

    act(() => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('checking');

    // Simulate the existing wallet channel invalidating → refetch → the new
    // ledger row arriving as a prop, WITHOUT advancing the fallback interval.
    rerender({ transactions: [NEW_TOP_UP] });

    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(2500);
    expect(result.current.returnCtaHref).toBe(RETURN_TO);
  });

  it('pokes refetch on the fallback interval while checking (realtime down)', () => {
    const refetch = jest.fn();
    const { result, rerender } = renderHook(
      ({ transactions }: Props) =>
        useWalletCreditWatch({ refetch, transactions }),
      { initialProps: { transactions: [OLD_TOP_UP] } as Props }
    );

    act(() => {
      result.current.armCheck();
    });
    refetch.mockClear();

    act(() => {
      jest.advanceTimersByTime(WALLET_FUNDING_POLLING.INTERVAL_MS);
    });
    expect(refetch).toHaveBeenCalledTimes(1);

    // The poll's refetch resolves with a credit that lands as a prop update.
    rerender({ transactions: [NEW_TOP_UP, OLD_TOP_UP] });
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(2500);
  });

  it('times out without claiming credited when no credit arrives', () => {
    const { result } = renderHook(() =>
      useWalletCreditWatch({ refetch: jest.fn(), transactions: [OLD_TOP_UP] })
    );

    act(() => {
      result.current.armCheck();
    });

    act(() => {
      jest.advanceTimersByTime(WALLET_FUNDING_POLLING.TIMEOUT_MS);
    });

    expect(result.current.status).toBe('timedOut');
    expect(result.current.creditedAmount).toBeNull();
    expect(result.current.returnCtaHref).toBeUndefined();
  });

  it('surfaces a credit that landed during the timeout window on re-arm', () => {
    const refetch = jest.fn();
    const { result, rerender } = renderHook(
      ({ transactions }: Props) =>
        useWalletCreditWatch({ refetch, transactions }),
      { initialProps: { transactions: [OLD_TOP_UP] } as Props }
    );

    act(() => {
      result.current.armCheck();
    });
    act(() => {
      jest.advanceTimersByTime(WALLET_FUNDING_POLLING.TIMEOUT_MS);
    });
    expect(result.current.status).toBe('timedOut');

    // The transfer settled late — after the watch already timed out. Tapping
    // "Check again" must credit immediately against the pre-transfer snapshot
    // instead of silently absorbing the late credit into a fresh baseline.
    rerender({ transactions: [NEW_TOP_UP, OLD_TOP_UP] });
    act(() => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(2500);

    // After acknowledging, the next cycle measures from the new ledger head.
    act(() => {
      result.current.reset();
    });
    act(() => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('checking');
    rerender({ transactions: [LATER_TOP_UP, NEW_TOP_UP, OLD_TOP_UP] });
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(500);
  });

  it('stays idle when the dark-launch flag is off (armCheck is a no-op)', () => {
    mockFlagEnabled = false;
    const refetch = jest.fn();
    const { result, rerender } = renderHook(
      ({ transactions }: Props) =>
        useWalletCreditWatch({ refetch, transactions }),
      { initialProps: { transactions: [OLD_TOP_UP] } as Props }
    );

    act(() => {
      result.current.armCheck();
    });

    expect(result.current.status).toBe('idle');
    expect(refetch).not.toHaveBeenCalled();

    rerender({ transactions: [NEW_TOP_UP, OLD_TOP_UP] });
    expect(result.current.status).toBe('idle');
  });

  it('does not flip to credited when no new top-up row appears', () => {
    const { result, rerender } = renderHook(
      ({ transactions }: Props) =>
        useWalletCreditWatch({ refetch: jest.fn(), transactions }),
      { initialProps: { transactions: [OLD_TOP_UP] } as Props }
    );

    act(() => {
      result.current.armCheck();
    });

    // A concurrent debit only removes money — never treat that as a credit.
    rerender({
      transactions: [
        {
          amount: 40,
          created_at: '2026-07-13T09:15:00.000Z',
          id: 'tx-debit',
          source_type: 'vtu_wallet_payment',
          type: 'debit',
        },
        OLD_TOP_UP,
      ],
    });
    expect(result.current.status).toBe('checking');
  });
});

describe('useWalletCreditWatch with a persisted funding session', () => {
  const CUSTOMER_ID = 'cus-1';
  const OTHER_CUSTOMER_ID = 'cus-2';
  const INTENT_ID = 'intent-1';
  // Device wall-clock. It is only ever used for the session TTL; it must never
  // decide which ledger rows count as "already there".
  const DEVICE_STARTED_AT = Date.parse('2026-07-13T08:55:00.000Z');
  // A card top-up writes the SAME `source_type = 'wallet_topup'` as a bank
  // transfer — the reason a time window alone cannot be trusted.
  const CARD_TOP_UP = topUp('tx-card', 9000, '2026-07-13T09:30:00.000Z');

  function session(
    overrides: Partial<WalletFundingSession> = {}
  ): WalletFundingSession {
    return {
      anchor: null,
      customerId: CUSTOMER_ID,
      intentId: INTENT_ID,
      isAnchored: false,
      startedAt: DEVICE_STARTED_AT,
      ...overrides,
    };
  }

  /** A session already pinned to the ledger row that was head at intent time. */
  function anchoredAt(transaction: WalletTopUpCandidate): WalletFundingSession {
    return session({ anchor: positionOf(transaction), isAnchored: true });
  }

  type SessionProps = {
    transactions: readonly WalletTopUpCandidate[] | undefined;
  };

  const renderWatch = async (
    transactions: readonly WalletTopUpCandidate[] | undefined
  ) => {
    const refetch = jest.fn();
    const view = renderHook(
      ({ transactions: rows }: SessionProps) =>
        useWalletCreditWatch({
          customerId: CUSTOMER_ID,
          refetch,
          returnTo: RETURN_TO,
          transactions: rows,
        }),
      { initialProps: { transactions } as SessionProps }
    );
    // Flush the async baseline resolution before the first arm.
    await act(async () => {});
    return view;
  };

  beforeEach(() => {
    mockFlagEnabled = true;
    mockReadSession.mockReset();
    mockAnchorSession.mockReset();
    mockClearSession.mockReset();
    mockAnchorSession.mockResolvedValue(null);
    mockClearSession.mockResolvedValue(undefined);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('does not read or anchor the ledger before the route session write settles', async () => {
    mockReadSession.mockResolvedValue(null);
    const refetch = jest.fn();
    const { result, rerender } = renderHook(
      ({ canResolveBaseline }: { canResolveBaseline: boolean }) =>
        useWalletCreditWatch({
          canResolveBaseline,
          customerId: CUSTOMER_ID,
          refetch,
          transactions: [OLD_TOP_UP],
        }),
      { initialProps: { canResolveBaseline: false } }
    );

    await act(async () => {});
    expect(mockReadSession).not.toHaveBeenCalled();

    act(() => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('idle');

    rerender({ canResolveBaseline: true });
    await act(async () => {});
    expect(mockReadSession).toHaveBeenCalledWith(CUSTOMER_ID);

    act(() => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('checking');
  });

  it('resolves a fresh baseline when the route gate cycles true → false → true', async () => {
    mockReadSession.mockResolvedValueOnce(anchoredAt(OLD_TOP_UP));
    const refetch = jest.fn();
    type GateProps = {
      canResolveBaseline: boolean;
      transactions: readonly WalletTopUpCandidate[];
    };
    const { result, rerender } = renderHook(
      ({ canResolveBaseline, transactions }: GateProps) =>
        useWalletCreditWatch({
          canResolveBaseline,
          customerId: CUSTOMER_ID,
          refetch,
          transactions,
        }),
      {
        initialProps: {
          canResolveBaseline: true,
          transactions: [NEW_TOP_UP, OLD_TOP_UP],
        } as GateProps,
      }
    );
    await act(async () => {});

    // A new route intent starts. Its persisted session uses the current ledger
    // head (tx-new), so reopening the gate must not retain tx-old.
    mockReadSession.mockResolvedValueOnce(anchoredAt(NEW_TOP_UP));
    rerender({
      canResolveBaseline: false,
      transactions: [NEW_TOP_UP, OLD_TOP_UP],
    });
    rerender({
      canResolveBaseline: true,
      transactions: [NEW_TOP_UP, OLD_TOP_UP],
    });
    await act(async () => {});

    expect(mockReadSession).toHaveBeenCalledTimes(2);
    act(() => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('checking');

    rerender({
      canResolveBaseline: true,
      transactions: [LATER_TOP_UP, NEW_TOP_UP, OLD_TOP_UP],
    });
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(500);
  });

  it('anchors the session on the ledger head when the customer arrives with intent', async () => {
    // The gap between arrival and this first ledger load is milliseconds, and
    // strictly before any account number can be on screen — nothing can have
    // landed inside it.
    const arriving = session();
    mockReadSession.mockResolvedValue(arriving);
    mockAnchorSession.mockResolvedValue(anchoredAt(OLD_TOP_UP));

    const { result, rerender } = await renderWatch([OLD_TOP_UP]);

    expect(mockAnchorSession).toHaveBeenCalledWith(
      arriving,
      positionOf(OLD_TOP_UP)
    );

    act(() => {
      result.current.armCheck();
    });
    rerender({ transactions: [NEW_TOP_UP, OLD_TOP_UP] });
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(2500);
  });

  it('credits a transfer that landed while the app was killed and the screen remounted', async () => {
    // The customer started a bank transfer, left for their bank app, and the
    // wallet screen remounted only AFTER the credit was already in the ledger.
    // The persisted anchor is the row that was head at intent time (tx-old).
    mockReadSession.mockResolvedValue(anchoredAt(OLD_TOP_UP));
    const { result } = await renderWatch([NEW_TOP_UP, OLD_TOP_UP]);

    act(() => {
      result.current.armCheck();
    });

    // Baselined on the stored ledger position (not on the current head), so the
    // top-up that landed after it is still a NEW credit.
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(2500);
    expect(result.current.returnCtaHref).toBe(RETURN_TO);
    // The stored anchor is never overwritten by the (now newer) head.
    expect(mockAnchorSession).not.toHaveBeenCalled();
  });

  it('does not credit a pre-intent top-up when the DEVICE CLOCK runs behind the server', async () => {
    // Regression (codex "anchor funding sessions to server time"): `startedAt` is
    // a device reading. A phone whose clock is an hour slow stamps the intent
    // BEFORE a top-up that already existed, and a wall-clock comparison would
    // then announce that old top-up as a fresh credit. The ledger-position anchor
    // makes the device clock irrelevant: tx-new was already the head at intent,
    // so it is baseline, not news.
    mockReadSession.mockResolvedValue(
      session({
        anchor: positionOf(NEW_TOP_UP),
        isAnchored: true,
        startedAt: Date.parse('2026-07-13T07:55:00.000Z'),
      })
    );
    const { result, rerender } = await renderWatch([NEW_TOP_UP, OLD_TOP_UP]);

    act(() => {
      result.current.armCheck();
    });

    expect(result.current.status).toBe('checking');
    expect(result.current.creditedAmount).toBeNull();

    // Only a row strictly newer than the anchored one (server time vs server
    // time) credits.
    rerender({ transactions: [LATER_TOP_UP, NEW_TOP_UP, OLD_TOP_UP] });
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(500);
  });

  it('clears the session once the credit has been shown', async () => {
    mockReadSession.mockResolvedValue(anchoredAt(OLD_TOP_UP));
    const { result } = await renderWatch([NEW_TOP_UP, OLD_TOP_UP]);

    await act(async () => {
      result.current.armCheck();
    });

    // Otherwise a later remount would re-baseline before the same top-up and
    // announce it a second time.
    expect(mockClearSession).toHaveBeenCalledWith(CUSTOMER_ID);
  });

  it('does not credit a top-up that predates the intent', async () => {
    // Anchored on the ledger head as it was at intent: nothing new has landed.
    mockReadSession.mockResolvedValue(anchoredAt(NEW_TOP_UP));
    const { result } = await renderWatch([NEW_TOP_UP, OLD_TOP_UP]);

    act(() => {
      result.current.armCheck();
    });

    expect(result.current.status).toBe('checking');
    expect(result.current.creditedAmount).toBeNull();
  });

  it('ignores cashback and reversals that land after the intent', async () => {
    mockReadSession.mockResolvedValue(anchoredAt(OLD_TOP_UP));
    const { result } = await renderWatch([
      REVERSAL_CREDIT,
      CASHBACK,
      OLD_TOP_UP,
    ]);

    act(() => {
      result.current.armCheck();
    });

    expect(result.current.status).toBe('checking');
  });

  it('ignores a top-up whose timestamp cannot be parsed', async () => {
    mockReadSession.mockResolvedValue(anchoredAt(OLD_TOP_UP));
    const { result, rerender } = await renderWatch([OLD_TOP_UP]);

    act(() => {
      result.current.armCheck();
    });
    rerender({
      transactions: [topUp('tx-unparseable', 3000, 'not-a-date'), OLD_TOP_UP],
    });

    expect(result.current.status).toBe('checking');
  });

  it('falls back to the ledger head when the marker is missing, expired or another customer’s', async () => {
    // readWalletFundingSession returns null for all three cases.
    mockReadSession.mockResolvedValue(null);
    const { result } = await renderWatch([NEW_TOP_UP, OLD_TOP_UP]);

    act(() => {
      result.current.armCheck();
    });

    // No anchor: the ledger head becomes the baseline, so nothing is claimed.
    expect(result.current.status).toBe('checking');
    expect(result.current.creditedAmount).toBeNull();
  });

  it('is fail-open and never false-credits when the session read rejects', async () => {
    mockReadSession.mockRejectedValue(new Error('storage unavailable'));
    const { result, rerender } = await renderWatch([NEW_TOP_UP, OLD_TOP_UP]);

    act(() => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('checking');

    // The watch still works — a genuinely new top-up is detected.
    rerender({ transactions: [LATER_TOP_UP, NEW_TOP_UP, OLD_TOP_UP] });
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(500);
  });

  it('refuses to arm before the baseline resolves', async () => {
    let resolveSession: (value: null) => void = () => undefined;
    mockReadSession.mockReturnValue(
      new Promise<null>((resolve) => {
        resolveSession = resolve;
      })
    );
    const refetch = jest.fn();
    const { result } = renderHook(() =>
      useWalletCreditWatch({
        customerId: CUSTOMER_ID,
        refetch,
        transactions: [OLD_TOP_UP],
      })
    );

    act(() => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('idle');
    expect(refetch).not.toHaveBeenCalled();

    await act(async () => {
      resolveSession(null);
    });
    act(() => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('checking');
  });

  it('credits when auth hydrates (undefined→id) after the ledger already rendered', async () => {
    // Cold start after an app kill: the persisted react-query cache can hand the
    // wallet ledger to a first committed render while the auth store is still
    // hydrating (customerId undefined). The baseline taken then has no session
    // anchor, so it MUST be re-resolved once the customer — and their session —
    // resolve, otherwise the landed credit is baselined away.
    mockReadSession.mockResolvedValue(anchoredAt(OLD_TOP_UP));
    const refetch = jest.fn();
    type HydratingProps = { customerId: string | undefined };
    const { result, rerender } = renderHook(
      ({ customerId }: HydratingProps) =>
        useWalletCreditWatch({
          customerId,
          refetch,
          returnTo: RETURN_TO,
          transactions: [NEW_TOP_UP, OLD_TOP_UP],
        }),
      { initialProps: { customerId: undefined } as HydratingProps }
    );
    await act(async () => {});

    rerender({ customerId: CUSTOMER_ID });
    await act(async () => {});
    act(() => {
      result.current.armCheck();
    });

    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(2500);
  });

  it('mints NO session when the credit is acknowledged, so a later card top-up cannot be announced as a transfer', async () => {
    // Regression (the proven false-credit vector): `reset()` used to re-anchor a
    // fresh 2-hour session at the moment of the "Done" tap — a moment of NO
    // funding intent. A card top-up writes the same `source_type='wallet_topup'`
    // and would sit strictly after that anchor, so a routine remount plus a tap
    // of "I've transferred" announced "Wallet credited ₦9,000" for money that was
    // never transferred.
    mockReadSession.mockResolvedValue(anchoredAt(OLD_TOP_UP));
    const { result } = await renderWatch([NEW_TOP_UP, OLD_TOP_UP]);

    await act(async () => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('credited');
    expect(mockClearSession).toHaveBeenCalledWith(CUSTOMER_ID);

    // The credit retired the marker, so the re-resolution after "Done" reads
    // nothing back.
    mockReadSession.mockResolvedValue(null);
    mockAnchorSession.mockClear();
    await act(async () => {
      result.current.reset();
    });
    await act(async () => {});

    // Nothing is written back: acknowledging a credit expresses no new intent.
    expect(mockAnchorSession).not.toHaveBeenCalled();

    // The customer then tops up with a CARD, and the wallet screen remounts (a
    // tab switch is enough). With the session retired, the remount baselines on
    // the ledger head — which now includes the card top-up.
    const remounted = await renderWatch([CARD_TOP_UP, NEW_TOP_UP, OLD_TOP_UP]);

    act(() => {
      remounted.result.current.armCheck();
    });

    // A timeout is the correct outcome here; announcing a credit is not.
    expect(remounted.result.current.status).toBe('checking');
    expect(remounted.result.current.creditedAmount).toBeNull();
    act(() => {
      jest.advanceTimersByTime(WALLET_FUNDING_POLLING.TIMEOUT_MS);
    });
    expect(remounted.result.current.status).toBe('timedOut');
  });

  it('still detects a second transfer made from the same mounted screen after a credit', async () => {
    // The cost of refusing to re-anchor: detection survives only while this
    // screen stays mounted. That path must keep working.
    mockReadSession.mockResolvedValue(anchoredAt(OLD_TOP_UP));
    const { result, rerender } = await renderWatch([NEW_TOP_UP, OLD_TOP_UP]);

    await act(async () => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('credited');

    mockReadSession.mockResolvedValue(null);
    await act(async () => {
      result.current.reset();
    });
    await act(async () => {});

    await act(async () => {
      result.current.armCheck();
    });
    // The acknowledged credit is part of the new baseline — never announced twice.
    expect(result.current.status).toBe('checking');
    expect(result.current.creditedAmount).toBeNull();

    rerender({ transactions: [LATER_TOP_UP, NEW_TOP_UP, OLD_TOP_UP] });
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(500);
  });

  it('fully resets the watch when the customer switches mid-check', async () => {
    // Regression (codex #3): re-resolving only the session anchor left `status`,
    // `creditedAmount` and the ledger baselines belonging to the PREVIOUS
    // customer. The next render then compared the new customer's ledger against
    // the old customer's baseline — crediting the wrong account and leaking the
    // other customer's amount.
    mockReadSession.mockResolvedValue(null);
    const refetch = jest.fn();
    type SwitchProps = {
      customerId: string;
      transactions: readonly WalletTopUpCandidate[];
    };
    const { result, rerender } = renderHook(
      ({ customerId, transactions }: SwitchProps) =>
        useWalletCreditWatch({
          customerId,
          refetch,
          returnTo: RETURN_TO,
          transactions,
        }),
      {
        initialProps: {
          customerId: CUSTOMER_ID,
          transactions: [OLD_TOP_UP],
        } as SwitchProps,
      }
    );
    await act(async () => {});

    act(() => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('checking');

    // A different customer signs in on the same device. Their ledger carries a
    // top-up that is newer than the FIRST customer's baseline.
    rerender({
      customerId: OTHER_CUSTOMER_ID,
      transactions: [NEW_TOP_UP, OLD_TOP_UP],
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.creditedAmount).toBeNull();
    expect(result.current.returnCtaHref).toBeUndefined();
    // The previous customer's watch must not retire the NEW customer's session.
    expect(mockClearSession).not.toHaveBeenCalledWith(OTHER_CUSTOMER_ID);

    // The new customer re-arms from THEIR own ledger head, so their pre-existing
    // top-up is baseline, not a credit.
    await act(async () => {});
    act(() => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('checking');
    expect(result.current.creditedAmount).toBeNull();
  });

  it('clears a shown credit amount and CTA when the customer switches', async () => {
    // The leak half of the same bug: an amount (and a return CTA) belonging to
    // the previous customer must never survive into the next customer's session.
    mockReadSession.mockResolvedValue(anchoredAt(OLD_TOP_UP));
    const { result, rerender } = renderHook(
      ({ customerId }: { customerId: string }) =>
        useWalletCreditWatch({
          customerId,
          refetch: jest.fn(),
          returnTo: RETURN_TO,
          transactions: [NEW_TOP_UP, OLD_TOP_UP],
        }),
      { initialProps: { customerId: CUSTOMER_ID } }
    );
    await act(async () => {});

    await act(async () => {
      result.current.armCheck();
    });
    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(2500);

    mockReadSession.mockResolvedValue(null);
    rerender({ customerId: OTHER_CUSTOMER_ID });

    expect(result.current.status).toBe('idle');
    expect(result.current.creditedAmount).toBeNull();
    expect(result.current.returnCtaHref).toBeUndefined();
  });

  it('is a no-op when the dark-launch flag is off even with a live session', async () => {
    mockFlagEnabled = false;
    mockReadSession.mockResolvedValue(anchoredAt(OLD_TOP_UP));
    const { result } = await renderWatch([NEW_TOP_UP, OLD_TOP_UP]);

    act(() => {
      result.current.armCheck();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.returnCtaHref).toBeUndefined();
  });

  it('DOES announce a card top-up that lands inside a genuine transfer window (known residual)', async () => {
    // Honest documentation of the residual: `wallet_topup` is written for card
    // funding too, so a card top-up completed after a real bank-transfer intent
    // is announced as "credited". The wallet WAS funded and the return CTA is
    // valid — but the copy is imprecise. Discriminating the two needs a
    // server-side provenance field on the ledger row.
    mockReadSession.mockResolvedValue(anchoredAt(OLD_TOP_UP));
    const { result, rerender } = await renderWatch([OLD_TOP_UP]);

    act(() => {
      result.current.armCheck();
    });
    rerender({ transactions: [CARD_TOP_UP, OLD_TOP_UP] });

    expect(result.current.status).toBe('credited');
    expect(result.current.creditedAmount).toBe(9000);
  });
});

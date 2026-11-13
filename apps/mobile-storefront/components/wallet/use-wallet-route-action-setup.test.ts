import { act, renderHook, waitFor } from '@testing-library/react-native';
import { useWalletRouteActionSetup } from '@/components/wallet/use-wallet-route-action-setup';
import type { WalletReturnHref } from '@/lib/sanitize-wallet-return-to';
import { storeWalletFundingIntent } from '@/lib/wallet-funding-intent';
import { startWalletFundingSession } from '@/lib/wallet-funding-session';

jest.mock('@/lib/wallet-funding-intent', () => ({
  storeWalletFundingIntent: jest.fn(),
}));
jest.mock('@/lib/wallet-funding-session', () => ({
  startWalletFundingSession: jest.fn(async () => null),
}));
const mockWarn = jest.fn();
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: (...args: unknown[]) => mockWarn(...args) }),
}));

const mockStartSession = jest.mocked(startWalletFundingSession);
const storeIntent = jest.mocked(storeWalletFundingIntent);

const noopSetters = {
  setFundAmount: jest.fn(),
  setFundReturnTo: jest.fn(),
  setShowFundPanel: jest.fn(),
  setShowRedeemPanel: jest.fn(),
  setShowSavingsProgressModal: jest.fn(),
};

function buildParams(
  overrides: Partial<{
    canCreateFundingAccount: boolean;
    createFundingAccount: () => void;
    customerId: string | undefined;
    hasFundingAccount: boolean;
    hasWalletData: boolean;
    isCreating: boolean;
    needsPhone: boolean;
    routeAction: string | undefined;
    routeIntentId: string | undefined;
    walletReturnTo: WalletReturnHref | undefined;
  }> = {}
) {
  const {
    canCreateFundingAccount = true,
    createFundingAccount = jest.fn(),
    customerId = 'customer-1',
    hasFundingAccount = false,
    hasWalletData = true,
    isCreating = false,
    needsPhone = false,
    routeAction = 'bank-transfer',
    routeIntentId = 'intent-1',
    walletReturnTo = undefined,
  } = overrides;

  return {
    bankTransfer: {
      canCreateFundingAccount,
      createFundingAccount,
      hasFundingAccount,
      hasWalletData,
      isCreating,
      needsPhone,
    },
    customerId,
    routeAction,
    routeIntentId,
    routeRequiredAmount: '',
    walletReturnTo,
    ...noopSetters,
  };
}

describe('useWalletRouteActionSetup', () => {
  it('reopens a closed savings modal when a named-goal deep link changes goals', () => {
    const { rerender } = renderHook(
      ({ goalId }: { goalId: string }) =>
        useWalletRouteActionSetup({
          ...buildParams({ routeAction: 'savings' }),
          routeSavingsGoalId: goalId,
        }),
      { initialProps: { goalId: 'goal-a' } }
    );
    noopSetters.setShowSavingsProgressModal.mockClear();

    rerender({ goalId: 'goal-b' });

    expect(noopSetters.setShowSavingsProgressModal).toHaveBeenCalledWith(true);
    noopSetters.setShowSavingsProgressModal.mockClear();
    rerender({ goalId: 'goal-b' });
    expect(noopSetters.setShowSavingsProgressModal).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    storeIntent.mockResolvedValue(undefined);
    // Most tests assert route behavior synchronously and do not need the
    // session-ready transition. Keep the default write pending so it cannot
    // produce an unrelated post-assertion state update outside `act`.
    mockStartSession.mockImplementation(
      () => new Promise<null>(() => undefined)
    );
  });

  it('records a resumable destination for a later wallet-credit push', async () => {
    renderHook(() =>
      useWalletRouteActionSetup(
        buildParams({
          walletReturnTo: '/utilities/power?repeatAmount=2000',
        })
      )
    );

    await waitFor(() =>
      expect(storeIntent).toHaveBeenCalledWith({
        customerId: 'customer-1',
        returnTo: '/utilities/power?repeatAmount=2000',
      })
    );
  });

  it('handles a rejected intent write without an unhandled rejection', async () => {
    storeIntent.mockRejectedValueOnce(new Error('storage unavailable'));

    renderHook(() =>
      useWalletRouteActionSetup(buildParams({ walletReturnTo: '/checkout' }))
    );

    await waitFor(() =>
      expect(mockWarn).toHaveBeenCalledWith(
        'Wallet funding intent write rejected.',
        expect.objectContaining({ error: expect.any(Error) })
      )
    );
  });

  it('records the funding intent for the card fund surface too (the customer may still transfer)', async () => {
    renderHook(() =>
      useWalletRouteActionSetup(
        buildParams({ routeAction: 'fund', walletReturnTo: '/imei-check' })
      )
    );

    await waitFor(() =>
      expect(storeIntent).toHaveBeenCalledWith({
        customerId: 'customer-1',
        returnTo: '/imei-check',
      })
    );
  });

  it('clears a stale intent when the wallet is opened without a returnTo', async () => {
    renderHook(() => useWalletRouteActionSetup(buildParams()));

    await waitFor(() =>
      expect(storeIntent).toHaveBeenCalledWith({
        customerId: 'customer-1',
        returnTo: undefined,
      })
    );
  });

  it.each([
    undefined,
    'savings',
  ])('preserves an armed funding intent for an unrelated %s wallet open', async (routeAction) => {
    renderHook(() =>
      useWalletRouteActionSetup({ ...buildParams(), routeAction })
    );

    await waitFor(() => expect(storeIntent).not.toHaveBeenCalled());
  });

  it('does not arm an intent from returnTo on a non-funding wallet route', async () => {
    renderHook(() =>
      useWalletRouteActionSetup(
        buildParams({ routeAction: 'savings', walletReturnTo: '/checkout' })
      )
    );

    await act(async () => {});
    expect(storeIntent).not.toHaveBeenCalled();
  });

  it('restamps the stored destination when a new funding nonce arrives', async () => {
    const { rerender } = renderHook(
      (props: ReturnType<typeof buildParams>) =>
        useWalletRouteActionSetup(props),
      {
        initialProps: buildParams({
          routeIntentId: 'intent-1',
          walletReturnTo: '/checkout',
        }),
      }
    );
    await waitFor(() => expect(storeIntent).toHaveBeenCalledTimes(1));

    rerender(
      buildParams({
        routeIntentId: 'intent-2',
        walletReturnTo: '/checkout',
      })
    );

    await waitFor(() => expect(storeIntent).toHaveBeenCalledTimes(2));
    expect(storeIntent).toHaveBeenNthCalledWith(1, {
      customerId: 'customer-1',
      returnTo: '/checkout',
    });
    expect(storeIntent).toHaveBeenNthCalledWith(2, {
      customerId: 'customer-1',
      returnTo: '/checkout',
    });
    expect(mockStartSession).toHaveBeenLastCalledWith('customer-1', 'intent-2');
  });

  it('waits for the customer before recording an intent, then records it scoped to them', async () => {
    // An unattributable intent must never be written: it could otherwise be
    // consumed by whoever is signed in when the credit lands.
    type SetupParams = Parameters<typeof useWalletRouteActionSetup>[0];
    const hydratingParams: SetupParams = {
      ...buildParams({
        routeAction: 'bank-transfer',
        walletReturnTo: '/checkout',
      }),
      // Explicit: buildParams' default would otherwise supply a customer id.
      customerId: undefined,
    };

    const { rerender } = renderHook(
      (props: SetupParams) => useWalletRouteActionSetup(props),
      { initialProps: hydratingParams }
    );

    await waitFor(() => expect(storeIntent).not.toHaveBeenCalled());

    rerender(
      buildParams({
        customerId: 'customer-9',
        routeAction: 'bank-transfer',
        walletReturnTo: '/checkout',
      })
    );

    await waitFor(() =>
      expect(storeIntent).toHaveBeenCalledWith({
        customerId: 'customer-9',
        returnTo: '/checkout',
      })
    );
  });

  it('creates the funding account once for action=bank-transfer when none exists', () => {
    const createFundingAccount = jest.fn();
    const params = buildParams({ createFundingAccount });

    const { rerender } = renderHook(
      (props: ReturnType<typeof buildParams>) =>
        useWalletRouteActionSetup(props),
      { initialProps: params }
    );

    expect(createFundingAccount).toHaveBeenCalledTimes(1);

    rerender(buildParams({ createFundingAccount }));

    expect(createFundingAccount).toHaveBeenCalledTimes(1);
  });

  it('does not create an account when one already exists', () => {
    const createFundingAccount = jest.fn();

    renderHook(() =>
      useWalletRouteActionSetup(
        buildParams({ createFundingAccount, hasFundingAccount: true })
      )
    );

    expect(createFundingAccount).not.toHaveBeenCalled();
  });

  it('waits for the wallet data to load before creating', () => {
    const createFundingAccount = jest.fn();
    const initial = buildParams({ createFundingAccount, hasWalletData: false });

    const { rerender } = renderHook(
      (props: ReturnType<typeof buildParams>) =>
        useWalletRouteActionSetup(props),
      { initialProps: initial }
    );

    expect(createFundingAccount).not.toHaveBeenCalled();

    rerender(buildParams({ createFundingAccount, hasWalletData: true }));

    expect(createFundingAccount).toHaveBeenCalledTimes(1);
  });

  it('does not create when the merchant has funding accounts disabled', () => {
    const createFundingAccount = jest.fn();

    renderHook(() =>
      useWalletRouteActionSetup(
        buildParams({ canCreateFundingAccount: false, createFundingAccount })
      )
    );

    expect(createFundingAccount).not.toHaveBeenCalled();
  });

  it('opens the fund panel and clears the latch when a phone is needed', () => {
    const createFundingAccount = jest.fn();
    const params = buildParams({
      canCreateFundingAccount: false,
      createFundingAccount,
      needsPhone: true,
    });

    const { rerender } = renderHook(
      (props: ReturnType<typeof buildParams>) =>
        useWalletRouteActionSetup(props),
      { initialProps: params }
    );

    // Fund panel opened for the phone prompt; no doomed create call, no
    // silent no-op that leaves the intent latched forever.
    expect(noopSetters.setShowFundPanel).toHaveBeenCalledWith(true);
    expect(createFundingAccount).not.toHaveBeenCalled();

    // Latch cleared: a re-render must not re-open the panel.
    noopSetters.setShowFundPanel.mockClear();
    rerender(
      buildParams({
        canCreateFundingAccount: false,
        createFundingAccount,
        needsPhone: true,
      })
    );
    expect(noopSetters.setShowFundPanel).not.toHaveBeenCalled();
  });

  it('does nothing for non-bank-transfer actions', () => {
    const createFundingAccount = jest.fn();

    renderHook(() =>
      useWalletRouteActionSetup(
        buildParams({ createFundingAccount, routeAction: 'fund' })
      )
    );

    expect(createFundingAccount).not.toHaveBeenCalled();
  });

  it('re-arms and creates for a new customer on the same bank-transfer route', () => {
    const createFundingAccount = jest.fn();

    const { rerender } = renderHook(
      (props: ReturnType<typeof buildParams>) =>
        useWalletRouteActionSetup(props),
      {
        initialProps: buildParams({
          createFundingAccount,
          customerId: 'customer-1',
        }),
      }
    );

    expect(createFundingAccount).toHaveBeenCalledTimes(1);

    // Same route (action=bank-transfer), but a different customer is now
    // signed in — their own account must be provisioned, not left consumed
    // by the previous customer's latch.
    rerender(buildParams({ createFundingAccount, customerId: 'customer-2' }));

    expect(createFundingAccount).toHaveBeenCalledTimes(2);
  });

  it('starts a persisted funding session on arrival with bank-transfer intent', () => {
    // The session anchors the credit watch's baseline; it must be written at
    // the moment of intent so it survives the customer leaving for their bank
    // app and the screen remounting after the credit already landed.
    renderHook(() => useWalletRouteActionSetup(buildParams()));

    expect(mockStartSession).toHaveBeenCalledWith('customer-1', 'intent-1');
  });

  it('keeps credit-baseline resolution gated until the session write settles', async () => {
    let settle: (() => void) | undefined;
    mockStartSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = () =>
            resolve({
              anchor: null,
              customerId: 'customer-1',
              intentId: 'intent-1',
              isAnchored: false,
              startedAt: 1,
            });
        })
    );

    const { result } = renderHook(() =>
      useWalletRouteActionSetup(buildParams())
    );

    expect(result.current).toBe(false);

    await act(async () => {
      settle?.();
    });

    expect(result.current).toBe(true);
  });

  it('allows a ledger baseline fallback when session storage is unavailable', async () => {
    mockStartSession.mockResolvedValueOnce(null);

    const { result } = renderHook(() =>
      useWalletRouteActionSetup(buildParams())
    );

    expect(result.current).toBe(false);
    await act(async () => {});
    expect(result.current).toBe(true);
  });

  it('keeps the readiness gate closed when the session write rejects', async () => {
    mockStartSession.mockRejectedValueOnce(new Error('storage exploded'));

    const { result } = renderHook(() =>
      useWalletRouteActionSetup(buildParams())
    );

    expect(result.current).toBe(false);
    await act(async () => {});
    expect(result.current).toBe(false);
  });

  it('replays the SAME intent id on a remount, and a NEW one on a new navigation', () => {
    // Regression (codex #1): the session write-site re-runs on every arrival, so
    // it is what must distinguish "the same attempt, seen again" (keep the
    // anchor — the credit landed while the customer was in their bank app) from
    // "a second attempt" (restamp — otherwise the first attempt's credit is
    // announced as this one's). The nonce carried by the route is that identity.
    const { rerender } = renderHook(
      (props: ReturnType<typeof buildParams>) =>
        useWalletRouteActionSetup(props),
      { initialProps: buildParams({ routeIntentId: 'intent-1' }) }
    );

    // Remount / re-render of the same navigation: same nonce, so the session
    // helper preserves the anchor.
    rerender(buildParams({ routeIntentId: 'intent-1' }));
    expect(mockStartSession).toHaveBeenCalledTimes(1);
    expect(mockStartSession).toHaveBeenLastCalledWith('customer-1', 'intent-1');

    // The customer taps "Pay with Bank Transfer" again: new nonce → restamp.
    rerender(buildParams({ routeIntentId: 'intent-2' }));
    expect(mockStartSession).toHaveBeenCalledTimes(2);
    expect(mockStartSession).toHaveBeenLastCalledWith('customer-1', 'intent-2');
  });

  it('does not start a funding session for other route actions or without a customer', () => {
    renderHook(() =>
      useWalletRouteActionSetup(buildParams({ routeAction: 'fund' }))
    );
    expect(mockStartSession).not.toHaveBeenCalled();

    // Auth not hydrated yet: no customer to scope the marker to.
    renderHook(() =>
      useWalletRouteActionSetup({
        ...buildParams(),
        customerId: undefined,
      })
    );
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it('starts the new customer’s session when the account switches on a bank-transfer route', () => {
    const { rerender } = renderHook(
      (props: ReturnType<typeof buildParams>) =>
        useWalletRouteActionSetup(props),
      { initialProps: buildParams({ customerId: 'customer-1' }) }
    );

    rerender(buildParams({ customerId: 'customer-2' }));

    expect(mockStartSession).toHaveBeenCalledWith('customer-2', 'intent-1');
  });

  it('does not disturb a fund route when the customer hydrates async (undefined→id)', () => {
    // Auth init sets user with customer:null first, then hydrates the
    // customer. A customerId transition on a NON-bank-transfer route must
    // not re-apply the route action (which would re-seed the fund amount).
    const fundParams = (customerId: string | undefined) => ({
      bankTransfer: {
        canCreateFundingAccount: true,
        createFundingAccount: jest.fn(),
        hasFundingAccount: false,
        hasWalletData: true,
        isCreating: false,
        needsPhone: false,
      },
      customerId,
      routeAction: 'fund',
      routeIntentId: undefined,
      routeRequiredAmount: '5000',
      walletReturnTo: undefined,
      ...noopSetters,
    });

    const { rerender } = renderHook(
      (props: ReturnType<typeof fundParams>) =>
        useWalletRouteActionSetup(props),
      { initialProps: fundParams(undefined) }
    );

    noopSetters.setFundAmount.mockClear();

    // Customer hydrates on the same fund route.
    rerender(fundParams('customer-1'));

    expect(noopSetters.setFundAmount).not.toHaveBeenCalled();
  });
});

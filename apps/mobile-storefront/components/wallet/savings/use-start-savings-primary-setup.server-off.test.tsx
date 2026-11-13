import { act, renderHook } from '@testing-library/react-native';
import { setupExistingSavingsGoal } from '@/lib/customer-savings';
import {
  clearObservedPiggyvestPrimaryCapability,
  observePiggyvestPrimaryCapability,
} from '@/lib/piggyvest-primary-capability-cache';
import { useStartSavingsPrimarySetup } from './use-start-savings-primary-setup';

jest.mock('@/lib/is-piggyvest-primary-merchant', () => ({
  isPiggyvestPrimaryMerchant: (id?: string) => id === 'pv-merchant',
}));
jest.mock('@/lib/customer-savings', () => ({
  setupExistingSavingsGoal: jest.fn(() =>
    Promise.resolve({ status: 'pending' })
  ),
}));

describe('useStartSavingsPrimarySetup with PiggyVest off', () => {
  it('keeps auto debit, asks no interest question and starts no setup', () => {
    const { result } = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'm',
        primaryWallet: false,
        wallet: { balance: 0, loyalty_points: 0 },
      })
    );
    expect(result.current.allowAutoDebit).toBe(true);
    expect(result.current.askInterest).toBe(false);
    expect(result.current.startGoalWalletSetup).toBeUndefined();
  });
});

describe('useStartSavingsPrimarySetup for a PiggyVest wallet', () => {
  it('starts the plan wallet setup with the interest answer from the form', async () => {
    const { result } = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'pv-merchant',
        primaryWallet: true,
      })
    );
    expect(result.current.allowAutoDebit).toBe(false);
    expect(result.current.startGoalWalletSetup).toBeUndefined();
    act(() => result.current.setInterestChoice(true));
    await result.current.startGoalWalletSetup?.('goal-1');
    expect(setupExistingSavingsGoal).toHaveBeenCalledWith({
      goalId: 'goal-1',
      merchantId: 'pv-merchant',
      interestAccepted: true,
    });
  });
});

describe('bugfix: auto debit was offered before the wallet type was known', () => {
  it('hides auto debit while the wallet is loading or unavailable', () => {
    const loading = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'm',
        primaryWallet: false,
      })
    );
    expect(loading.result.current.allowAutoDebit).toBe(false);
    const unavailable = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'm',
        primaryWallet: false,
        wallet: { balance: 0, loyalty_points: 0, primary_unavailable: true },
      })
    );
    expect(unavailable.result.current.allowAutoDebit).toBe(false);
  });

  it.each([
    ['still loading', undefined],
    [
      'unavailable',
      { balance: 0, loyalty_points: 0, primary_unavailable: true as const },
    ],
  ])('treats a PiggyVest merchant as PiggyVest while the wallet is %s', (_label, wallet) => {
    const { result } = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'pv-merchant',
        primaryWallet: false,
        wallet,
      })
    );
    expect(result.current.allowAutoDebit).toBe(false);
    expect(result.current.askInterest).toBe(true);
  });
});

describe('bugfix: the interest answer carried over to another account', () => {
  it('clears the answer when the signed-in account changes', () => {
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string }) =>
        useStartSavingsPrimarySetup({
          activeMerchantId: 'm',
          primaryWallet: true,
          userId,
        }),
      { initialProps: { userId: 'user-a' } }
    );
    act(() => result.current.setInterestChoice(true));
    expect(result.current.interestChoice).toBe(true);
    rerender({ userId: 'user-b' });
    expect(result.current.interestChoice).toBeNull();
    expect(result.current.startGoalWalletSetup).toBeUndefined();
  });
});

describe('the interest gate: null means unanswered, undefined means never asked', () => {
  it('never gives a PiggyVest plan an undefined answer, so the submit gate always sees it', () => {
    for (const input of [
      { activeMerchantId: 'pv-merchant', primaryWallet: true },
      { activeMerchantId: 'pv-merchant', primaryWallet: false },
    ]) {
      const { result } = renderHook(() => useStartSavingsPrimarySetup(input));
      expect(result.current.askInterest).toBe(true);
      expect(result.current.formInterestChoice).toBeNull();
      act(() => result.current.setInterestChoice(false));
      expect(result.current.formInterestChoice).toBe(false);
    }
  });

  it('gives a legacy plan undefined, which the submit gate lets through', () => {
    const { result } = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'm',
        primaryWallet: false,
        wallet: { balance: 0, loyalty_points: 0 },
      })
    );
    expect(result.current.formInterestChoice).toBeUndefined();
  });
});

describe('bugfix: switching accounts and back brought an old interest answer back', () => {
  it('clears the answer when the signed-in account changes', () => {
    const { result, rerender } = renderHook(
      (props: { userId: string }) =>
        useStartSavingsPrimarySetup({
          activeMerchantId: 'pv-merchant',
          primaryWallet: true,
          userId: props.userId,
        }),
      { initialProps: { userId: 'user-a' } }
    );
    act(() => result.current.setInterestChoice(true));
    expect(result.current.interestChoice).toBe(true);
    rerender({ userId: 'user-b' });
    expect(result.current.interestChoice).toBeNull();
    rerender({ userId: 'user-a' });
    expect(result.current.interestChoice).toBeNull();
  });
});

describe('bugfix: a legacy-wallet customer at a PiggyVest merchant was treated as PiggyVest', () => {
  it('keeps the legacy rail once the wallet read shows a legacy wallet', () => {
    const { result } = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'pv-merchant',
        primaryWallet: false,
        wallet: { balance: 0, loyalty_points: 0 },
      })
    );
    expect(result.current.askInterest).toBe(false);
    expect(result.current.allowAutoDebit).toBe(true);
    expect(result.current.formInterestChoice).toBeUndefined();
  });
});

describe('bugfix: cached PiggyVest wallet kept the PiggyVest form after a rollback', () => {
  afterEach(() => {
    clearObservedPiggyvestPrimaryCapability();
  });

  it('drops to the legacy form once the live verdict rules PiggyVest out', () => {
    // Arrange: a known PiggyVest wallet at the pilot; its reclassification
    // refetch failed, so the cached wallet still reads as PiggyVest.
    const { result } = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'pv-merchant',
        primaryWallet: true,
        wallet: {
          balance: 0,
          loyalty_points: 0,
          primary_balance_kobo: 500_000,
        },
      })
    );
    expect(result.current.askInterest).toBe(true);

    // Act: another request rolls the shared verdict back to false.
    act(() => observePiggyvestPrimaryCapability('pv-merchant', false));

    // Assert: legacy form, no PiggyVest goal-wallet setup.
    expect(result.current.askInterest).toBe(false);
    expect(result.current.allowAutoDebit).toBe(true);
    expect(result.current.startGoalWalletSetup).toBeUndefined();
  });
});

describe('bugfix: pending PiggyVest account treated as a known legacy wallet', () => {
  it('keeps a pending PiggyVest wallet on the PiggyVest form', () => {
    // Arrange: account confirmed, balance not ready, so primaryWallet is false.
    const { result } = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'pv-merchant',
        primaryWallet: false,
        wallet: { balance: 0, loyalty_points: 0, primary_pending: true },
      })
    );

    // Assert: interest asked, no legacy auto debit.
    expect(result.current.askInterest).toBe(true);
    expect(result.current.allowAutoDebit).toBe(false);
  });

  it('treats a wallet with no owner yet as unknown, not legacy', () => {
    const { result } = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'pv-merchant',
        primaryWallet: false,
        wallet: { balance: 0, loyalty_points: 0, owner_unresolved: true },
      })
    );
    expect(result.current.askInterest).toBe(true);
    expect(result.current.allowAutoDebit).toBe(false);
  });

  it('keeps an owned legacy wallet at a non-PiggyVest merchant on legacy', () => {
    const { result } = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'm',
        primaryWallet: false,
        wallet: { balance: 0, loyalty_points: 0 },
      })
    );
    expect(result.current.askInterest).toBe(false);
    expect(result.current.allowAutoDebit).toBe(true);
  });

  it("keeps today's auto debit for an ownerless wallet at another merchant", () => {
    const { result } = renderHook(() =>
      useStartSavingsPrimarySetup({
        activeMerchantId: 'm',
        primaryWallet: false,
        wallet: { balance: 0, loyalty_points: 0, owner_unresolved: true },
      })
    );
    expect(result.current.askInterest).toBe(false);
    expect(result.current.allowAutoDebit).toBe(true);
  });
});

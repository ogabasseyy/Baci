import { describe, expect, it, vi } from 'vitest';
import { setupPrimarySavingsGoal } from './primary-savings-goal-setup';
import {
  fixture,
  goalId,
  walletName,
} from './primary-savings-provisioning.input.test-support';

vi.mock('server-only', () => ({}));

function setupInput(stored: { interestAccepted: boolean } | null) {
  const { mode: _mode, interestAccepted: _ignored, ...base } = fixture();
  const claimed = {
    status: 'claimed' as const,
    claimToken: 'claim',
    providerCustomerId: 'customer',
    primaryWalletId: 'primary',
    providerWalletId: null,
    walletName,
  };
  const pending = { ...claimed, status: 'pending' as const, claimToken: null };
  base.store.read.mockReset();
  base.store.prepare.mockReset();
  base.store.read.mockResolvedValueOnce(
    stored ? { ...pending, interestAccepted: stored.interestAccepted } : null
  );
  // After a claim the follow-up status read sees the recorded wallet.
  base.store.read.mockResolvedValue({
    ...pending,
    providerWalletId: 'destination',
    interestAccepted: stored?.interestAccepted ?? false,
  });
  base.listWallets.mockResolvedValueOnce([]);
  return { ...base, claimed, pending };
}

describe('setupPrimarySavingsGoal', () => {
  it('reads status before it prepares or provisions anything', async () => {
    const input = setupInput(null);
    input.store.prepare.mockResolvedValue({
      ...input.claimed,
      interestAccepted: true,
    });
    await setupPrimarySavingsGoal({ ...input, requestedInterest: true });
    expect(input.store.read.mock.invocationCallOrder[0]).toBeLessThan(
      input.store.prepare.mock.invocationCallOrder[0]
    );
  });

  it.each([
    true,
    false,
  ])('stores and uses the customer-chosen answer (%s) when none is stored', async (choice) => {
    const input = setupInput(null);
    input.store.prepare.mockResolvedValue({
      ...input.claimed,
      interestAccepted: choice,
    });
    await setupPrimarySavingsGoal({ ...input, requestedInterest: choice });
    expect(input.store.prepare).toHaveBeenCalledExactlyOnceWith(goalId, choice);
    expect(input.createWallet).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ enableInterestAccrual: choice })
    );
  });

  it.each([
    undefined,
    null,
    'yes',
    1,
  ])('refuses a missing or non-boolean choice (%s) with nothing stored or sent', async (choice) => {
    const input = setupInput(null);
    const outcome = await setupPrimarySavingsGoal({
      ...input,
      requestedInterest: choice as unknown as boolean,
    });
    expect(outcome.status).toBe('choice_required');
    expect(outcome.accounts).toEqual([]);
    expect(input.store.prepare).not.toHaveBeenCalled();
    expect(input.createWallet).not.toHaveBeenCalled();
  });

  it.each([
    true,
    false,
  ])('reuses the stored choice (%s) when the client sends none', async (stored) => {
    const input = setupInput({ interestAccepted: stored });
    input.store.prepare.mockResolvedValue({
      ...input.claimed,
      interestAccepted: stored,
    });
    const outcome = await setupPrimarySavingsGoal(input);
    expect(outcome.interestAccepted).toBe(stored);
    expect(input.store.prepare).toHaveBeenCalledExactlyOnceWith(goalId, stored);
    expect(input.createWallet).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ enableInterestAccrual: stored })
    );
  });

  it('refuses a client choice that contradicts the stored one', async () => {
    const input = setupInput({ interestAccepted: true });
    const outcome = await setupPrimarySavingsGoal({
      ...input,
      requestedInterest: false,
    });
    expect(outcome.status).toBe('conflict');
    expect(outcome.interestAccepted).toBe(true);
    expect(input.store.prepare).not.toHaveBeenCalled();
    expect(input.createWallet).not.toHaveBeenCalled();
  });

  it('does not call the provider while another setup holds an unexpired claim', async () => {
    const input = setupInput({ interestAccepted: false });
    input.store.prepare.mockResolvedValue({
      ...input.pending,
      interestAccepted: false,
    });
    input.listWallets.mockReset();
    input.listWallets.mockResolvedValue([]);
    const outcome = await setupPrimarySavingsGoal(input);
    expect(outcome.status).toBe('pending');
    expect(input.createWallet).not.toHaveBeenCalled();
    expect(input.store.record).not.toHaveBeenCalled();
  });

  it('reclaims an expired claim with the stored choice', async () => {
    const input = setupInput({ interestAccepted: true });
    // The database re-issues a fresh claim token once the old one expired.
    input.store.prepare.mockResolvedValue({
      ...input.claimed,
      claimToken: 'reclaimed',
      interestAccepted: true,
    });
    await setupPrimarySavingsGoal(input);
    expect(input.store.record).toHaveBeenCalledWith(
      goalId,
      'reclaimed',
      'destination'
    );
    expect(input.createWallet).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ enableInterestAccrual: true })
    );
  });

  it('fails closed when the status read cannot be completed', async () => {
    const input = setupInput(null);
    input.store.read.mockReset();
    input.store.read.mockRejectedValue(new Error('private database error'));
    const outcome = await setupPrimarySavingsGoal({
      ...input,
      requestedInterest: true,
    });
    expect(outcome.status).toBe('unavailable');
    expect(input.store.prepare).not.toHaveBeenCalled();
    expect(input.createWallet).not.toHaveBeenCalled();
  });
});

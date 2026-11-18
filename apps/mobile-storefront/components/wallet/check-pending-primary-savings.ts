import { triggerHaptic } from '@/hooks/use-haptics';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { checkPiggyvestPrimarySavingsStatus } from '@/lib/piggyvest-primary-savings-status';
import { savingsNotifier } from './savings/savings-notice';
import { walletRefreshWorked } from './wallet-refresh-worked';

/** What one status read found; the operation is kept unless it settled. */
export type PendingSavingsCheckOutcome =
  | 'confirmed'
  | 'cancelled'
  | 'not-found'
  | 'pending'
  | 'unavailable';

export async function checkPendingPrimarySavings(input: {
  /** The goal as it stood before this confirmation. */
  goal?: WalletActiveSavingsGoal | null;
  merchantId?: string;
  operationId: string;
  clearOperation: () => void;
  clearAmount: () => void;
  refetchWallet: () => Promise<unknown>;
  setPending: (value: boolean) => void;
  /** False once the screen that asked has gone: "still waiting" news is dropped. */
  isLive?: () => boolean;
  /** False once another operation (account, merchant or goal) took over. */
  isOurs?: () => boolean;
}): Promise<PendingSavingsCheckOutcome> {
  // Captured before any await: a result never reaches another account, and
  // a late answer for an operation no longer on screen posts nothing.
  const notifyScoped = savingsNotifier();
  const notify: typeof notifyScoped = (...args) => {
    if (input.isOurs?.() !== false) notifyScoped(...args);
  };
  input.setPending(true);
  try {
    const result = await checkPiggyvestPrimarySavingsStatus({
      merchantId: input.merchantId,
      operationId: input.operationId,
    });
    if (result.status === 'confirmed') {
      // Refresh before releasing the operation: until the new balance is in,
      // the pending card stays up, so no new contribution starts from the
      // pre-confirmation wallet and goal figures.
      const refreshFailed = !(await walletRefreshWorked(input.refetchWallet));
      input.clearOperation();
      input.clearAmount();
      if (input.isOurs?.() !== false) triggerHaptic('success');
      // The status endpoint returns neither the amount nor the goal balance,
      // and the amount field may have been edited since the transfer began,
      // so the cheer names the goal without an amount or percentage.
      const { goal } = input;
      if (goal) {
        notify(
          'Savings updated',
          `Nice! Your savings are confirmed. Every naira gets you closer to your ${goal.title}. Keep it going!${
            refreshFailed ? ' Pull to refresh your latest balance.' : ''
          }`,
          'success'
        );
      } else
        notify(
          'Savings updated',
          'Your contribution is confirmed. Your savings balance has been updated.',
          'success'
        );
      return 'confirmed';
    }
    if (result.status === 'cancelled') {
      const refreshFailed = !(await walletRefreshWorked(input.refetchWallet));
      input.clearOperation();
      notify(
        'Contribution cancelled',
        `Nothing was taken from your wallet.${
          refreshFailed ? ' Pull to refresh your latest balance.' : ''
        }`,
        'info'
      );
      return 'cancelled';
    }
    if (input.isLive?.() !== false)
      notify(
        'Contribution pending',
        'Still waiting for confirmation. No new payment has been started.',
        'info'
      );
    return 'pending';
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: unknown }).code
        : undefined;
    // SAVINGS_MERCHANT_NOT_PRIMARY is derived from runtime config, not the
    // provider record, so it never releases a primary id: it falls through to
    // the ambiguous branch below and the operation is kept.
    if (code === 'CONTRIBUTION_NOT_FOUND') {
      // Authoritative absence: the server joins the status read to the
      // caller's own intent, so not_found means this identity never
      // reserved this operation id (the initial POST died on CSRF,
      // transport, or early 503 — never a cross-identity leak, and the
      // controller drops the key on scope change before any foreign
      // query). Release the local operation and let the next tap
      // re-submit. The entered amount is kept. Ambiguous failures still
      // retain the operation for recovery.
      input.clearOperation();
      notify(
        'Contribution not received',
        'We have no record of this contribution, so you can safely try again.',
        'info'
      );
      return 'not-found';
    }
    // A timeout lands here too: the operation is kept and checked again.
    if (input.isLive?.() !== false)
      notify(
        'Status unavailable',
        'Could not confirm this contribution. Refresh its status later before starting another payment.',
        'warning'
      );
    return 'unavailable';
  } finally {
    input.setPending(false);
  }
}

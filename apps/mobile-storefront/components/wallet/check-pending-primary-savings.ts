import { triggerHaptic } from '@/hooks/use-haptics';
import type { WalletActiveSavingsGoal } from '@/hooks/wallet-query';
import { checkPiggyvestPrimarySavingsStatus } from '@/lib/piggyvest-primary-savings-status';
import { savingsNotifier } from './savings/savings-notice';

export async function checkPendingPrimarySavings(input: {
  /** The goal as it stood before this confirmation. */
  goal?: WalletActiveSavingsGoal | null;
  merchantId?: string;
  operationId: string;
  clearOperation: () => void;
  clearAmount: () => void;
  refetchWallet: () => Promise<unknown>;
  setPending: (value: boolean) => void;
}) {
  // Captured before any await: a result never reaches another account.
  const notify = savingsNotifier();
  input.setPending(true);
  try {
    const result = await checkPiggyvestPrimarySavingsStatus({
      merchantId: input.merchantId,
      operationId: input.operationId,
    });
    if (result.status === 'confirmed') {
      input.clearOperation();
      input.clearAmount();
      triggerHaptic('success');
      const refreshFailed = await input.refetchWallet().then(
        () => false,
        () => true
      );
      // The status endpoint returns neither the amount nor the goal balance,
      // and the amount field may have been edited since the transfer began,
      // so the cheer names the goal without an amount or percentage.
      const { goal } = input;
      if (goal) {
        notify(
          'Savings updated',
          `Nice! PiggyVest confirmed your savings. Every naira gets you closer to your ${goal.title}. Keep it going!${
            refreshFailed ? ' Pull to refresh your latest balance.' : ''
          }`,
          'success'
        );
      } else
        notify(
          'Savings updated',
          'PiggyVest has confirmed your contribution. Your savings balance has been updated.',
          'success'
        );
    } else if (result.status === 'cancelled') {
      input.clearOperation();
      await input.refetchWallet().catch(() => undefined);
      notify(
        'Contribution cancelled',
        'The transfer was cancelled before submission and your reserved wallet funds were released.',
        'info'
      );
    } else
      notify(
        'Contribution pending',
        'Still waiting for PiggyVest to confirm. No new payment has been started.',
        'info'
      );
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
        'PiggyVest has no record of this contribution. You can safely try again.',
        'info'
      );
      return;
    }
    notify(
      'Status unavailable',
      'Could not confirm this contribution. Refresh its status later before starting another payment.',
      'warning'
    );
  } finally {
    input.setPending(false);
  }
}

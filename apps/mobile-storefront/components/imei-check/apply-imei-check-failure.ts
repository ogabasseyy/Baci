import type { resolveImeiCheckFailure } from './resolve-imei-check-failure';

/** Carries out what a failed IMEI check answer calls for, in order. */
export async function applyImeiCheckFailure(
  outcome: ReturnType<typeof resolveImeiCheckFailure>,
  actions: {
    clearKey: () => void;
    signIn: () => void;
    topUp: (amount: number) => void;
    refetchWallet: () => Promise<unknown> | unknown;
    showError: (message: string) => void;
  }
) {
  if (outcome.shouldClearIdempotencyKey) actions.clearKey();
  if (outcome.shouldRedirectToLogin) return void actions.signIn();
  if (outcome.topUpAmount !== null)
    return void actions.topUp(outcome.topUpAmount);
  if (outcome.shouldRefetchWallet) await actions.refetchWallet();
  if (outcome.errorMessage) actions.showError(outcome.errorMessage);
}

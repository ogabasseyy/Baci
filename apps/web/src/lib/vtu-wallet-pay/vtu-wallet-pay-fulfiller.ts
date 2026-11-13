import 'server-only';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { walletPayRefuse } from '@/lib/piggyvest/wallet-pay-http';
import { readWalletPayRuntime } from '@/lib/piggyvest/wallet-pay-runtime';
import { fulfillPendingVtuTransaction } from '@/lib/vtu-fulfillment';
import type { VtuWalletOnlyChargeInput } from '@/schemas/vtu-wallet-only';
import { runVtuWalletPayStep } from './run-vtu-wallet-pay-step';
import { createVtuWalletPayStepDeps } from './vtu-wallet-pay-step-deps';

/**
 * For a wallet-only checkout that asked to pay from the PiggyVest wallet,
 * the step that replaces "fulfil now" on every path (fresh, replay, joined):
 * issue the payment, or pay and then vend under its delivery claim. Null
 * for store credit, so those paths stay exactly as they were. The privileged
 * client only ever reaches fulfillPendingVtuTransaction (the route's
 * approved fulfil operation); every PiggyVest call uses the wallet pay
 * ledger's own logins.
 */
export function createVtuWalletPayFulfiller(input: {
  charge: VtuWalletOnlyChargeInput;
  auth: { supabase: SupabaseClient; user: User };
  fulfillSupabase: SupabaseClient;
}) {
  if (input.charge.paymentMethod !== 'piggyvest_wallet') return null;
  const deps = createVtuWalletPayStepDeps(input.auth);
  return (merchantId: string, customerId: string) => (transactionId: string) =>
    runVtuWalletPayStep(
      {
        transactionId,
        merchantId,
        customerId,
        operationId: input.charge.walletPayOperationId,
        pinProof: input.charge.walletPayPinProof,
        cancel: input.charge.walletPayCancel,
        fulfil: (walletPayClaimed) =>
          fulfillPendingVtuTransaction({
            supabase: input.fulfillSupabase,
            transactionId,
            walletPayClaimed,
          }),
      },
      deps
    );
}

/**
 * Refuses a PiggyVest start while wallet pay is switched off, BEFORE the
 * purchase row is prepared and claimed: a row prepared for a payment that
 * can never be issued would hold the purchase intent, so a store credit
 * retry would join a row nothing can vend (Codex P2). Re-checks of money
 * already sent (an operation id) still go through, on the recovery runtime.
 */
export function refuseUnavailableWalletPayStart(
  charge: VtuWalletOnlyChargeInput,
  readRuntime: typeof readWalletPayRuntime = readWalletPayRuntime
) {
  if (charge.paymentMethod !== 'piggyvest_wallet') return null;
  if (charge.walletPayOperationId !== undefined) return null;
  let runtime: ReturnType<typeof readWalletPayRuntime>;
  try {
    runtime = readRuntime();
  } catch {
    runtime = null;
  }
  return runtime
    ? null
    : walletPayRefuse(
        'Paying from your PiggyVest wallet is not available right now.',
        'PIGGYVEST_PAY_UNAVAILABLE',
        503
      );
}

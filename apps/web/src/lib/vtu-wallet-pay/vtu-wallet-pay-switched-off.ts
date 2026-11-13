import 'server-only';
import { walletPayAccepted } from '@/lib/piggyvest/wallet-pay-http';
import { walletPayScope } from '@/lib/piggyvest/wallet-pay-scope';
import { cancelVtuWalletPay } from './vtu-wallet-pay-close';
import type { VtuWalletPayStepDeps } from './vtu-wallet-pay-step.types';

/**
 * A start or PIN-proof request while new airtime/data/bills payments are
 * switched off. It never issues or sends a payment, and reads only through
 * the recovery runtime (same store, same customer):
 *  - a start (a replayed purchase whose operation the app lost) hands back a
 *    payment that already moved money, so it resumes and is delivered
 *    (Codex P1); one that moved nothing is released and closed (Codex P2);
 *  - a PIN proof is refused, and its still-issued payment is released and the
 *    purchase closed, so a store credit retry never stays held (Codex P2).
 * Anything else answers `refusal` (the caller's unavailable answer).
 */
export async function answerWhileSwitchedOff(
  deps: VtuWalletPayStepDeps,
  input: {
    transactionId: string;
    merchantId: string;
    customerId: string;
    operationId?: string;
    amountKobo: number;
  },
  refusal: () => Promise<Response>
): Promise<Response> {
  let runtime: ReturnType<VtuWalletPayStepDeps['readRecoveryRuntime']>;
  try {
    runtime = deps.readRecoveryRuntime();
  } catch {
    return await refusal();
  }
  if (runtime.merchantId !== input.merchantId) return await refusal();
  const identity = await deps.resolveIdentity(runtime);
  if (!identity || identity.customerId !== input.customerId)
    return await refusal();
  const scope = walletPayScope(runtime, identity);
  const { transactionId, operationId } = input;
  if (operationId === undefined) {
    const existing = await deps.findForPurchase({
      runtime,
      scope,
      purpose: 'vtu',
      purchaseRef: transactionId,
    });
    if (existing && existing.state !== 'issued')
      return walletPayAccepted(
        existing.state === 'needs_review'
          ? 'payment_review'
          : 'payment_pending',
        existing.operationId,
        { transactionId, amountKobo: input.amountKobo }
      );
    // Nothing moved money: release a still-issued attempt (or, with none
    // live, e.g. one that expired) and close the purchase, so it never stays
    // stuck holding a store credit retry (Codex P2).
    const ref = { runtime, scope, transactionId };
    await Promise.resolve()
      .then(() =>
        existing
          ? cancelVtuWalletPay(deps.closeUnpaid, ref, existing.operationId)
          : deps.closeUnpaid(ref)
      )
      .catch(() => null);
    return await refusal();
  }
  // Only this operation, and only while still issued (the database refuses
  // a reserved one): money already moving is never released.
  await cancelVtuWalletPay(
    deps.closeUnpaid,
    { runtime, scope, transactionId },
    operationId
  ).catch(() => null);
  return await refusal();
}

import 'server-only';
import {
  walletPayAccepted,
  walletPayRefuse,
} from '@/lib/piggyvest/wallet-pay-http';
import { walletPayScope } from '@/lib/piggyvest/wallet-pay-scope';
import { cancelVtuWalletPay } from './vtu-wallet-pay-close';
import type { VtuWalletPayStepDeps } from './vtu-wallet-pay-step.types';

const startAgain = () =>
  walletPayRefuse(
    'Your earlier savings wallet payment for this purchase was not completed. Please try again.',
    'PAYMENT_NOT_COMPLETED',
    409
  );

/**
 * A store credit request that joined (or replays) a purchase prepared as paid
 * from the PiggyVest wallet (Codex P1). It never issues or sends a payment,
 * and reads only through the recovery runtime (same store, same customer):
 *  - a payment that already moved (or holds) money is reported, so the
 *    request waits for it and the drain delivers or refunds it;
 *  - a purchase nothing has paid is released (a still-issued attempt) and
 *    closed, so the store credit retry starts a fresh purchase instead of
 *    joining one only the PIN sheet could pay, which would wait forever;
 *  - a purchase that is no longer pending (vended, failed, closed) answers
 *    through `settled` (the plain fulfil, which replays its stored result).
 * When the payment ledger can't be read the request is told to retry.
 */
export async function answerStoreCreditJoin(
  input: {
    transactionId: string;
    merchantId: string;
    customerId: string;
    settled: () => Promise<Response>;
  },
  deps: VtuWalletPayStepDeps
): Promise<Response> {
  const { transactionId } = input;
  const retry = () =>
    walletPayRefuse(
      'Could not confirm this purchase yet. Please try again in a moment.',
      'PAYMENT_STATUS_UNKNOWN',
      503
    );
  const purchase = await deps.readPurchase(transactionId);
  if (
    !purchase?.piggyvestPaid ||
    (purchase.merchantId !== undefined &&
      purchase.merchantId !== input.merchantId) ||
    (purchase.customerId !== undefined &&
      purchase.customerId !== input.customerId)
  )
    return await input.settled();
  if (purchase.status !== undefined && purchase.status !== 'pending')
    return await input.settled();
  let runtime: ReturnType<VtuWalletPayStepDeps['readRecoveryRuntime']>;
  try {
    runtime = deps.readRecoveryRuntime();
  } catch {
    return retry();
  }
  if (runtime.merchantId !== input.merchantId) return retry();
  const identity = await deps.resolveIdentity(runtime);
  if (!identity || identity.customerId !== input.customerId) return retry();
  const scope = walletPayScope(runtime, identity);
  const existing = await deps.findForPurchase({
    runtime,
    scope,
    purpose: 'vtu',
    purchaseRef: transactionId,
  });
  if (existing && existing.state !== 'issued')
    return walletPayAccepted(
      existing.state === 'needs_review' ? 'payment_review' : 'payment_pending',
      existing.operationId,
      { transactionId, amountKobo: Math.round(purchase.amount * 100) }
    );
  // Nothing moved money. Only a still-issued attempt is released (the
  // database refuses a reserved one), and the purchase is closed only while
  // nothing holds money; a close that did not happen keeps the purchase and
  // the request retries.
  const ref = { runtime, scope, transactionId };
  const closed = existing
    ? await cancelVtuWalletPay(deps.closeUnpaid, ref, existing.operationId)
        .then(async (response) => {
          const body = (await response.json()) as { status?: string };
          return body.status === 'cancelled';
        })
        .catch(() => false)
    : await Promise.resolve()
        .then(() => deps.closeUnpaid(ref))
        .catch(() => false);
  return closed ? startAgain() : retry();
}

import { extractEdges, pickString } from './loose-schemas';
import { analysePayoutReadback, type PayoutReadback } from './payout-analysis';
import type { ProofContext } from './proof-context';
import type { QaIdentity } from './provider-ops';

export interface GoalOwner {
  qa: QaIdentity;
  customerId: string;
}

export interface GoalVariantResult {
  /** Wallet exists (created now, or found after a resumed slot); null if unknown. */
  exists: boolean | null;
  /** The create call was accepted; null if not sent or outcome unknown. */
  accepted: boolean | null;
  httpStatus: number | null;
  /** Raw provider message: pass through Redactor.message() before use. */
  errorMessage: string | null;
  resumedOutcome: string | null;
  readback: PayoutReadback | null;
  readbackData: unknown;
}

/**
 * Creates (or, on a resumed slot, finds by its deterministic name) one goal
 * sub-wallet and reads it back. `payoutWalletId` null leaves the wallet's own
 * payout unset, which is how inheritance from the customer is observed.
 */
export async function runGoalVariant(
  ctx: ProofContext,
  owner: GoalOwner,
  business: string,
  variant: { slot: string; nameSuffix: string; payoutWalletId: string | null }
): Promise<GoalVariantResult> {
  const { api, redactor } = ctx;
  const result: GoalVariantResult = {
    exists: null,
    accepted: null,
    httpStatus: null,
    errorMessage: null,
    resumedOutcome: null,
    readback: null,
    readbackData: undefined,
  };
  const sent = await api.createGoalWallet(
    owner.qa,
    owner.customerId,
    variant.slot,
    {
      nameSuffix: variant.nameSuffix,
      ...(variant.payoutWalletId
        ? { payoutWalletId: variant.payoutWalletId }
        : {}),
    }
  );
  let walletId: string | null = null;
  if (sent.kind === 'resumed') {
    result.resumedOutcome = sent.priorOutcome;
    const wanted = `${owner.qa.goalWalletName}${variant.nameSuffix}`.slice(
      0,
      120
    );
    const list = await api.customerWallets(owner.customerId, 'ASC');
    const found = extractEdges(list.data).edges.find(
      (edge) => pickString(edge, ['name']) === wanted
    );
    walletId = pickString(found, ['id']);
    result.exists = walletId !== null;
  } else {
    result.httpStatus = sent.call.httpStatus;
    if (sent.call.ok) {
      result.accepted = true;
      walletId = pickString(sent.call.data, ['id']);
      result.exists = walletId !== null;
    } else {
      result.accepted = sent.outcome === 'rejected' ? false : null;
      result.exists = sent.outcome === 'rejected' ? false : null;
      result.errorMessage = sent.call.message;
    }
  }
  if (walletId) {
    redactor.register('W', walletId);
    const detail = await api.wallet(walletId);
    result.readbackData = detail.data;
    result.readback = detail.ok
      ? analysePayoutReadback(detail.data, business, walletId)
      : null;
  }
  return result;
}

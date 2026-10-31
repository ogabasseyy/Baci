import {
  analysePayoutReadback,
  destinationReadable,
  mergePayoutReadbacks,
  type PayoutReadback,
} from './payout-analysis';
import type { ProofContext } from './proof-context';
import { pollSettled, recordOf } from './read-rules';

export interface PayoutReadbackResult {
  /**
   * Interest settings merged across every read that showed any (so a flag seen
   * early is kept); null if no read ever showed them.
   */
  facts: PayoutReadback | null;
  /** The last readback's data, for the shape record. */
  data: unknown;
  httpStatus: number | null;
  /** True once a payout destination field was readable; false if it never appeared in the budget. */
  settled: boolean;
  polls: number;
}

/**
 * Reads a wallet back after a create and waits (within the settle budget) for
 * its payout DESTINATION to become readable, not merely for some interest
 * setting to show: the accrual flag can appear reads before the destination.
 * Flags seen along the way are kept. A destination that never appears is
 * reported unsettled, so the caller answers `unknown`, never `no`.
 */
export async function readbackPayout(
  ctx: ProofContext,
  walletId: string,
  business: string
): Promise<PayoutReadbackResult> {
  const seen: { facts: PayoutReadback | null } = { facts: null };
  const read = async () => {
    const call = await ctx.api.wallet(walletId);
    const record = recordOf(call);
    const facts = record
      ? analysePayoutReadback(record, business, walletId)
      : null;
    if (facts && facts.interestFieldPaths.length > 0)
      seen.facts = mergePayoutReadbacks(seen.facts, facts);
    return call;
  };
  const polled = await pollSettled(ctx, read, () =>
    destinationReadable(seen.facts)
  );
  return {
    facts: seen.facts,
    data: polled.value.data,
    httpStatus: polled.value.httpStatus,
    settled: polled.settled,
    polls: polled.polls,
  };
}

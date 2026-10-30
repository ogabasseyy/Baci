import { analysePayoutReadback, type PayoutReadback } from './payout-analysis';
import type { ProofContext } from './proof-context';
import { pollSettled, recordOf } from './read-rules';

export interface PayoutReadbackResult {
  /** Present only once interest settings were visible in the readback. */
  facts: PayoutReadback | null;
  /** The last readback's data, for the shape record. */
  data: unknown;
  httpStatus: number | null;
  /** False if no interest settings appeared within the polling budget. */
  settled: boolean;
  polls: number;
}

/**
 * Reads a wallet back after a create and waits (within the settle budget) for
 * its interest settings to become visible. A readback that never shows them is
 * reported as unsettled: the caller answers `unknown`, never `no`.
 */
export async function readbackPayout(
  ctx: ProofContext,
  walletId: string,
  business: string
): Promise<PayoutReadbackResult> {
  const factsOf = (call: Awaited<ReturnType<typeof ctx.api.wallet>>) => {
    const record = recordOf(call);
    return record ? analysePayoutReadback(record, business, walletId) : null;
  };
  const polled = await pollSettled(
    ctx,
    () => ctx.api.wallet(walletId),
    (call) => (factsOf(call)?.interestFieldPaths.length ?? 0) > 0
  );
  return {
    facts: polled.settled ? factsOf(polled.value) : null,
    data: polled.value.data,
    httpStatus: polled.value.httpStatus,
    settled: polled.settled,
    polls: polled.polls,
  };
}

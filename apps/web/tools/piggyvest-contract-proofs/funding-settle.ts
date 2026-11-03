import { pickString, walletDataSchema } from './loose-schemas';
import type { ProofContext } from './proof-context';
import { okData, recordOf, usableList } from './read-rules';
import { analyseRecord } from './tsq-analysis';

/**
 * Did a test funding of `grossKobo` into a wallet fully land? A balance that
 * merely rose can be a first tranche or accrued interest, so it is settled
 * only when BOTH hold: the balance reached the funded level (the gross minus
 * the largest fee any record on the wallet shows, or 0), and the next poll
 * shows it unchanged (the stability rule `settledWallets` uses).
 */

/** The largest fee any credit record on the wallet shows; 0 if none shows one. */
async function maxRecordFeeKobo(
  ctx: ProofContext,
  walletId: string
): Promise<number> {
  const list = usableList(
    await ctx.api.transactions({ wallet_id: walletId, limit: '20' })
  );
  let max = 0;
  for (const edge of list?.edges ?? []) {
    const id = pickString(edge, ['id']);
    if (id === null || pickString(edge, ['type']) !== 'credit') continue;
    const record = recordOf(await ctx.api.transaction(id, walletId));
    const fee = analyseRecord(record, {
      sourceWalletId: null,
      destinationWalletId: walletId,
      amountKobo: null,
    }).feeKobo;
    if (fee !== null && fee > max) max = fee;
  }
  return max;
}

export async function fundingSettled(
  ctx: ProofContext,
  walletId: string,
  balanceBefore: number,
  grossKobo: number
): Promise<boolean> {
  let previous: number | null = null;
  let feeKobo: number | null = null;
  for (let poll = 0; poll < ctx.maxPolls; poll += 1) {
    const now = walletDataSchema.safeParse(
      okData(await ctx.api.wallet(walletId))
    );
    if (now.success) {
      const balance = now.data.balance;
      if (balance > balanceBefore && feeKobo === null)
        feeKobo = await maxRecordFeeKobo(ctx, walletId);
      const reached = balance >= balanceBefore + grossKobo - (feeKobo ?? 0);
      if (reached && previous === balance) return true;
      previous = balance;
    }
    await ctx.sleep(ctx.pollIntervalMs);
  }
  return false;
}

import { pickString, walletDataSchema } from './loose-schemas';
import type { ProofContext } from './proof-context';
import { okData, recordOf, usableList } from './read-rules';
import { movementSettled } from './settle-rule';
import { analyseRecord } from './tsq-analysis';

/**
 * Did a test funding of `grossKobo` into a wallet fully land? Judged by the
 * shared settle rule (settle-rule.ts): the balance shows the gross minus the
 * recorded fee, and the next poll shows it unchanged. The fee is re-read on
 * every poll until a credit record shows it, because the balance can show the
 * net credit before its record is listed.
 */

/**
 * The largest fee any credit record on the wallet shows, or null while no
 * credit record shows one yet (not visible, not readable, or no fee field).
 */
async function maxRecordFeeKobo(
  ctx: ProofContext,
  walletId: string
): Promise<number | null> {
  const list = usableList(
    await ctx.api.transactions({ wallet_id: walletId, limit: '20' })
  );
  let max: number | null = null;
  for (const edge of list?.edges ?? []) {
    const id = pickString(edge, ['id']);
    if (id === null || pickString(edge, ['type']) !== 'credit') continue;
    const record = recordOf(await ctx.api.transaction(id, walletId));
    const fee = analyseRecord(record, {
      sourceWalletId: null,
      destinationWalletId: walletId,
      amountKobo: null,
    }).feeKobo;
    if (fee !== null && (max === null || fee > max)) max = fee;
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
      // Never lock in an unread fee: keep looking until a record shows one.
      if (balance > balanceBefore && feeKobo === null)
        feeKobo = await maxRecordFeeKobo(ctx, walletId);
      if (
        movementSettled({
          creditedKobo: balance - balanceBefore,
          previousCreditedKobo:
            previous === null ? null : previous - balanceBefore,
          grossKobo,
          feeKobo,
        })
      )
        return true;
      previous = balance;
    }
    await ctx.sleep(ctx.pollIntervalMs);
  }
  return false;
}

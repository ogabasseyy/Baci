import { pickString, walletDataSchema } from './loose-schemas';
import type { ProofContext } from './proof-context';
import { okData, recordOf, usableList } from './read-rules';
import { movementSettled } from './settle-rule';
import { analyseRecord } from './tsq-analysis';

/**
 * Did a test funding of `grossKobo` into a wallet fully land? Judged by the
 * shared settle rule (settle-rule.ts): the balance shows the gross minus the
 * recorded fee, and the next poll shows it unchanged. The fee is re-read on
 * every poll until this funding's own credit record shows it, because the balance can show the
 * net credit before its record is listed.
 */

/**
 * The ids of the credit rows listed on a wallet right now, or null when the
 * list cannot be read. Captured BEFORE a funding is sent, so that funding's
 * own record can be told apart from older ones.
 */
export async function creditIdsOf(
  ctx: ProofContext,
  walletId: string
): Promise<ReadonlySet<string> | null> {
  const list = usableList(
    await ctx.api.transactions({ wallet_id: walletId, limit: '20' })
  );
  if (!list) return null;
  const ids = new Set<string>();
  for (const edge of list.edges) {
    const id = pickString(edge, ['id']);
    if (id !== null && pickString(edge, ['type']) === 'credit') ids.add(id);
  }
  return ids;
}

/**
 * The fee on THIS funding's own credit record: a credit row that was not
 * listed before the funding was sent. Null while no such row shows a fee
 * (not visible yet, not readable, no fee field, or the earlier rows could not
 * be listed so the own row cannot be told apart). Never a neighbour's fee.
 */
async function ownRecordFeeKobo(
  ctx: ProofContext,
  walletId: string,
  priorCreditIds: ReadonlySet<string> | null
): Promise<number | null> {
  if (priorCreditIds === null) return null;
  const list = usableList(
    await ctx.api.transactions({ wallet_id: walletId, limit: '20' })
  );
  let max: number | null = null;
  for (const edge of list?.edges ?? []) {
    const id = pickString(edge, ['id']);
    if (id === null || priorCreditIds.has(id)) continue;
    if (pickString(edge, ['type']) !== 'credit') continue;
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
  grossKobo: number,
  priorCreditIds: ReadonlySet<string> | null
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
        feeKobo = await ownRecordFeeKobo(ctx, walletId, priorCreditIds);
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

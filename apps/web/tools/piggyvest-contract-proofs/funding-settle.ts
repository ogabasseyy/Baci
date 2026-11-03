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
 * The fee on THIS funding's own credit record: the single credit row that was
 * not listed before the funding was sent AND whose amount is the gross. Null
 * (unread) when no such row shows a fee: zero candidates, MORE than one
 * candidate, an unreadable record, or earlier rows that could not be listed.
 * Never a neighbour's fee, never the largest of several.
 */
async function ownRecordFeeKobo(
  ctx: ProofContext,
  walletId: string,
  grossKobo: number,
  priorCreditIds: ReadonlySet<string> | null
): Promise<number | null> {
  if (priorCreditIds === null) return null;
  const list = usableList(
    await ctx.api.transactions({ wallet_id: walletId, limit: '20' })
  );
  const candidates = (list?.edges ?? []).filter((edge) => {
    const id = pickString(edge, ['id']);
    return (
      id !== null &&
      !priorCreditIds.has(id) &&
      pickString(edge, ['type']) === 'credit' &&
      (edge as Record<string, unknown>).amount === grossKobo
    );
  });
  const [only] = candidates;
  if (candidates.length !== 1) return null;
  const id = pickString(only, ['id']);
  if (id === null) return null;
  return analyseRecord(recordOf(await ctx.api.transaction(id, walletId)), {
    sourceWalletId: null,
    destinationWalletId: walletId,
    amountKobo: null,
  }).feeKobo;
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
        feeKobo = await ownRecordFeeKobo(
          ctx,
          walletId,
          grossKobo,
          priorCreditIds
        );
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

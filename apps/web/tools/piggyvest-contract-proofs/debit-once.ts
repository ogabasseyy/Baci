import { pickString } from './loose-schemas';
import type { ProofContext } from './proof-context';
import { recordOf } from './read-rules';
import { analyseRecord } from './tsq-analysis';
import type { Answer } from './types';

/**
 * Was a source wallet debited for exactly ONE transfer of `amountKobo`?
 * The debit is the amount, plus at most the fee the provider's own record
 * shows. Excess that the record does not explain is never tolerated: it is
 * `unknown` when no fee was read, and `no` when the fee does not account for
 * it. A debit below the amount, or a full extra amount, is always `no`.
 */
export function debitedOnce(
  amountKobo: number,
  debitKobo: number,
  feeKobo: number | null
): Answer {
  if (debitKobo < amountKobo) return 'no';
  const excess = debitKobo - amountKobo;
  if (excess === 0) return 'yes';
  if (excess >= amountKobo) return 'no';
  if (feeKobo === null) return 'unknown';
  return excess === feeKobo ? 'yes' : 'no';
}

/** Reads the fee the status record shows for a reference; null if none. */
export async function readTransferFeeKobo(
  ctx: ProofContext,
  reference: string,
  walletId: string
): Promise<number | null> {
  const record = recordOf(await ctx.api.verify(reference, walletId));
  if (!record || pickString(record, ['status']) === null) return null;
  return analyseRecord(record, {
    sourceWalletId: walletId,
    destinationWalletId: null,
    amountKobo: null,
  }).feeKobo;
}

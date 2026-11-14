import { debitedOnce } from './debit-once';
import type { Answer } from './types';

/**
 * The ONE conservative rule for the S8 transfer verdicts.
 *
 * yes: the readbacks show the expected movement and any shortfall or excess
 *   equals a fee actually read from the transaction record (zero if none).
 * no: the readbacks directly contradict a single transfer (a movement of at
 *   least the amount more than expected, the wrong direction, or a read fee
 *   that does not explain the difference).
 * unknown: everything else (no fee read, nothing moved, not settled).
 */

/** Was a wallet credited for exactly ONE transfer of `grossKobo`? */
export function creditedOnce(
  grossKobo: number,
  creditedKobo: number,
  feeKobo: number | null
): Answer {
  if (creditedKobo > grossKobo) return 'no';
  if (creditedKobo === grossKobo) return 'yes';
  if (creditedKobo < 0) return 'no';
  if (creditedKobo === 0 || feeKobo === null) return 'unknown';
  return creditedKobo === grossKobo - feeKobo ? 'yes' : 'no';
}

export interface TransferVerdict {
  answer: Answer;
  /** Why the answer is unknown; undefined otherwise. */
  detail: string | undefined;
}

/** A debit on the source and a credit on the destination, one transfer. */
export function transferVerdict(
  amountKobo: number,
  debitKobo: number,
  creditKobo: number,
  feeKobo: number | null
): TransferVerdict {
  const debit = debitedOnce(amountKobo, debitKobo, feeKobo);
  const credit = creditedOnce(amountKobo, creditKobo, feeKobo);
  if (debit === 'no' || credit === 'no')
    return { answer: 'no', detail: undefined };
  // A recorded fee explains the difference ONCE across both wallets: a debit
  // above the amount AND a credit below it would charge it twice.
  const feeTwice =
    feeKobo !== null &&
    feeKobo !== 0 &&
    debitKobo > amountKobo &&
    creditKobo < amountKobo;
  if (feeTwice) return { answer: 'no', detail: undefined };
  if (debit === 'yes' && credit === 'yes')
    return { answer: 'yes', detail: undefined };
  const parts: string[] = [];
  if (debit === 'unknown')
    parts.push(
      'the source debit exceeds the amount and the record shows no fee that explains it'
    );
  if (credit === 'unknown')
    parts.push(
      creditKobo === 0
        ? 'the destination credit is zero'
        : 'the destination credit is below the amount and no fee was read'
    );
  return { answer: 'unknown', detail: parts.join('; ') };
}

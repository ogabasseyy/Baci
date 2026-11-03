import { transferVerdict } from './verdict-rule';

/**
 * The ONE settle rule for every place that marks a money movement settled
 * (a test funding, a measured deposit, a main -> goal transfer).
 *
 * A movement is settled only when the destination balance shows the FULL
 * expected credit - the gross minus the fee the record shows - AND the next
 * observation shows the balance unchanged. A balance that merely rose may be
 * a first tranche, so a partial credit is never settled. A fee that has not
 * been read, or whose record is not yet visible, is `null` and is never
 * treated as a fee of 0 that gets locked in: callers re-read it until a
 * record shows it, and until then only the full gross counts as complete.
 */

/** The credit a landed movement shows: gross minus its own recorded fee (unread: the gross). */
export function expectedCreditKobo(
  grossKobo: number,
  feeKobo: number | null
): number {
  return grossKobo - (feeKobo ?? 0);
}

/**
 * Did the destination show EXACTLY one transfer's credit? Over-credit is not
 * complete: it is evidence of a double booking, never a settled single
 * movement. An unread credit never is.
 */
export function creditComplete(
  creditedKobo: number | null,
  grossKobo: number,
  feeKobo: number | null
): boolean {
  return (
    creditedKobo !== null &&
    creditedKobo === expectedCreditKobo(grossKobo, feeKobo)
  );
}

/**
 * Settled: the full credit is shown now AND the previous observation showed
 * the same credit (nothing moved between the two polls).
 */
export function movementSettled(observation: {
  creditedKobo: number | null;
  previousCreditedKobo: number | null;
  grossKobo: number;
  feeKobo: number | null;
}): boolean {
  const { creditedKobo, previousCreditedKobo, grossKobo, feeKobo } =
    observation;
  return (
    creditComplete(creditedKobo, grossKobo, feeKobo) &&
    previousCreditedKobo === creditedKobo
  );
}

/**
 * A repeat or second transfer has landed in full only when the source debit
 * AND the destination credit each match ONE whole transfer of `amountKobo`
 * (the amount, plus or minus the fee its own record shows). A partial,
 * mismatched, one-sided or unexplained movement is never settled.
 */
export function oneFullTransferLanded(
  amountKobo: number,
  debitKobo: number,
  creditKobo: number,
  feeKobo: number | null
): boolean {
  return (
    transferVerdict(amountKobo, debitKobo, creditKobo, feeKobo).answer === 'yes'
  );
}

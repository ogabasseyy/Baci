import { z } from 'zod';

const kobo = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const piggyvestSavingsLedgerSnapshotSchema = z
  .object({
    ledger: z
      .object({
        confirmedPrincipalKobo: kobo,
        reservedPrincipalKobo: kobo,
        paidEligibleInterestKobo: kobo,
        reservedPaidInterestKobo: kobo,
        pendingInterestKobo: kobo,
      })
      .strict(),
    activeReservation: z
      .object({
        operationId: z.uuid(),
        kind: z.enum(['reserve_purchase', 'reserve_refund']),
        principalKobo: kobo,
        interestKobo: kobo,
      })
      .strict()
      .nullable(),
    fundingReversed: z.boolean(),
  })
  .strict()
  .superRefine(({ ledger, activeReservation }, context) => {
    if (
      ledger.reservedPrincipalKobo > ledger.confirmedPrincipalKobo ||
      ledger.reservedPaidInterestKobo > ledger.paidEligibleInterestKobo ||
      ledger.reservedPrincipalKobo !==
        (activeReservation?.principalKobo ?? 0) ||
      ledger.reservedPaidInterestKobo !==
        (activeReservation?.interestKobo ?? 0) ||
      (activeReservation?.kind === 'reserve_refund' &&
        activeReservation.interestKobo !== 0) ||
      (activeReservation !== null &&
        activeReservation.principalKobo + activeReservation.interestKobo ===
          0) ||
      !Number.isSafeInteger(
        ledger.confirmedPrincipalKobo + ledger.paidEligibleInterestKobo
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Inconsistent ledger snapshot',
      });
    }
  });

export type PiggyvestSavingsLedgerSnapshot = z.infer<
  typeof piggyvestSavingsLedgerSnapshotSchema
>;

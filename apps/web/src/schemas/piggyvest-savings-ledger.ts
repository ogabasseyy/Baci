import { z } from 'zod';

const kobo = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const piggyvestSavingsLedgerSchema = z
  .object({
    operationId: z.uuid(),
    kind: z.enum([
      'credit_principal',
      'record_pending_interest',
      'credit_eligible_paid_interest',
      'reserve_purchase',
      'reserve_refund',
      'release_purchase',
      'settle_reservation',
      'reverse_credit',
    ]),
    principalKobo: kobo,
    interestKobo: kobo,
    evidenceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
    referenceId: z.uuid().nullable(),
  })
  .strict()
  .superRefine((command, context) => {
    const { kind, principalKobo, interestKobo, referenceId } = command;
    const referenced = [
      'release_purchase',
      'settle_reservation',
      'reverse_credit',
    ].includes(kind);
    const valid = referenced
      ? referenceId !== null && principalKobo === 0 && interestKobo === 0
      : referenceId === null &&
        (kind === 'credit_principal' || kind === 'reserve_refund'
          ? principalKobo > 0 && interestKobo === 0
          : kind === 'reserve_purchase'
            ? principalKobo > 0 || interestKobo > 0
            : principalKobo === 0 && interestKobo > 0);
    if (!valid || !Number.isSafeInteger(principalKobo + interestKobo)) {
      context.addIssue({
        code: 'custom',
        message: 'Invalid internal ledger amounts or reference',
      });
    }
  });

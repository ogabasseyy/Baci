import 'server-only';
import z from 'zod';
import { type PiggyvestClientConfig, piggyvestRequest } from './client';

/**
 * PiggyVest scheduled payments (sandbox-gated, no live calls).
 *
 * Latest-docs patterns applied:
 * - Create returns only a `schedule_payment_id`; execution stays on the
 *   provider's clock per `start_date`/`frequency`/`end_date`.
 * - Cancel and reactivate share one PATCH with `is_active`; the provider
 *   refuses reactivation once `end_date` has passed, so callers must read
 *   the error instead of assuming the schedule resumed.
 * - `destination_code` is required when `destination_type` is "bank", and a
 *   bank destination id must be a 10-digit NUBAN — enforced here so a
 *   malformed schedule never reaches the provider.
 * - Dates cross the boundary as provider-local "YYYY-MM-DD HH:mm:ss"
 *   strings; futurity of `start_date` is provider-enforced (timezone-safe
 *   choice: we validate shape, the provider validates clock).
 */

const providerDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    'Date must be YYYY-MM-DD HH:mm:ss'
  );

const createSchedulePaymentInputSchema = z
  .object({
    amountKobo: z.int().positive(),
    startDate: providerDateTimeSchema.optional(),
    payoutType: z.enum(['recurring', 'one-time']),
    frequency: z.enum(['day', 'week', 'month']),
    sourceWalletId: z.string().min(1),
    destinationType: z.enum(['wallet', 'bank']),
    description: z.string().max(200).optional(),
    destinationId: z.string().min(1),
    destinationCode: z.string().min(1).optional(),
    endDate: providerDateTimeSchema.optional(),
  })
  .superRefine((input, issue) => {
    if (input.destinationType === 'bank') {
      if (!input.destinationCode) {
        issue.addIssue({
          code: 'custom',
          message: 'destinationCode is required for bank destinations',
          path: ['destinationCode'],
        });
      }
      if (!/^\d{10}$/.test(input.destinationId)) {
        issue.addIssue({
          code: 'custom',
          message: 'Bank destination id must be a 10-digit NUBAN',
          path: ['destinationId'],
        });
      }
    }
  });

export type CreateSchedulePaymentInput = z.input<
  typeof createSchedulePaymentInputSchema
>;

const updateSchedulePaymentInputSchema = z.object({
  schedulePaymentId: z.string().min(1),
  isActive: z.boolean(),
  nextChargeAttempt: providerDateTimeSchema.optional(),
});

export type UpdateSchedulePaymentInput = z.input<
  typeof updateSchedulePaymentInputSchema
>;

const createSchedulePaymentDataSchema = z.object({
  schedule_payment_id: z.string().min(1),
});

export type CreateSchedulePaymentResult = z.infer<
  typeof createSchedulePaymentDataSchema
>;

// Cancel/reactivate answers with a confirmation message only; the envelope
// check in piggyvestRequest is the contract, `data` is irrelevant.
const updateSchedulePaymentDataSchema = z.unknown();

export interface UpdateSchedulePaymentResult {
  updated: true;
}

export function createSchedulePayment(
  config: PiggyvestClientConfig,
  input: CreateSchedulePaymentInput
): Promise<CreateSchedulePaymentResult> {
  const parsed = createSchedulePaymentInputSchema.parse(input);
  return piggyvestRequest(
    config,
    createSchedulePaymentDataSchema,
    '/api/v1/transfer/schedule-payment',
    {
      body: {
        amount: parsed.amountKobo,
        start_date: parsed.startDate,
        payout_type: parsed.payoutType,
        frequency: parsed.frequency,
        source_wallet_id: parsed.sourceWalletId,
        destination_type: parsed.destinationType,
        description: parsed.description,
        destination_id: parsed.destinationId,
        destination_code: parsed.destinationCode,
        end_date: parsed.endDate,
      },
    }
  );
}

export async function updateSchedulePayment(
  config: PiggyvestClientConfig,
  input: UpdateSchedulePaymentInput
): Promise<UpdateSchedulePaymentResult> {
  const parsed = updateSchedulePaymentInputSchema.parse(input);
  await piggyvestRequest(
    config,
    updateSchedulePaymentDataSchema,
    `/api/v1/transfer/schedule-payment/${encodeURIComponent(parsed.schedulePaymentId)}`,
    {
      method: 'PATCH',
      body: {
        is_active: parsed.isActive,
        next_charge_attempt: parsed.nextChargeAttempt,
      },
    }
  );
  return { updated: true };
}

import { z } from 'zod';

const id = z.uuid().transform((value) => value.toLowerCase());
const walletId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
const kobo = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const action = z.enum(['purchase', 'cancellation']);

const transfer = z
  .object({
    action,
    operationId: id,
    reference: id,
    sourceWalletId: walletId,
    destinationWalletId: walletId,
    amountKobo: kobo.positive(),
    currency: z.literal('NGN'),
  })
  .strict();

export const savingsExitExecutionSchemas = {
  configuration: z
    .object({
      integrationId: id,
      merchantId: id,
      customerId: id,
      goalId: id,
      expectedBusinessId: z.string().min(1).max(128),
      actorId: id,
    })
    .strict(),
  command: z.object({ operationId: id }).strict(),
  request: z.object({ goalId: id, operationId: id }).strict(),
  policy: z
    .object({
      policyId: id,
    })
    .strict(),
  transfer,
  accountingRows: z
    .array(
      z
        .object({
          result: z
            .object({
              state: z.enum(['accounted', 'pending_projection', 'pending']),
              operationId: id,
            })
            .strict(),
        })
        .strict()
    )
    .length(1),
  beginRows: z
    .array(
      z
        .object({
          result: z
            .object({
              state: z.enum([
                'submit',
                'verify',
                'pending_projection',
                'requires_reconciliation',
                'deferred',
              ]),
              operationId: id,
              transfer: transfer.optional(),
            })
            .strict(),
        })
        .strict()
    )
    .length(1),
  finality: transfer
    .extend({ status: z.enum(['success', 'pending', 'failed', 'unknown']) })
    .strict(),
  finalRows: z
    .array(
      z
        .object({
          result: z
            .object({
              state: z.enum([
                'pending_projection',
                'pending',
                'requires_reconciliation',
              ]),
              operationId: id,
            })
            .strict(),
        })
        .strict()
    )
    .length(1),
};

export type SavingsExitTransfer = z.infer<
  typeof savingsExitExecutionSchemas.transfer
>;
export type SavingsExitAction = z.infer<typeof action>;

import { z } from 'zod';
export const experienceApplyInput = z.strictObject({
  buildId: z.uuid(),
  evidenceId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.uuid(),
});
export const experiencePublicationInput = experienceApplyInput.extend({
  expectedPublishedVersion: z.number().int().nonnegative(),
});
export const experienceApprovalPost = z.strictObject({
  action: z.enum([
    'prepare-draft',
    'prepare-publication',
    'confirm-draft',
    'confirm-publication',
    'confirm-mode-exit',
  ]),
  approvalId: z.uuid(),
});
export const experienceApprovalRef = z.strictObject({
  approvalId: z.uuid(),
  effectDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }),
  status: z.literal('confirmation-required'),
});
export const experienceLifecyclePublicationBinding = z.object({
  merchantId: z.uuid(),
  buildId: z.uuid(),
  action: z.enum(['publish', 'rollback']),
  status: z
    .enum(['confirmation-required', 'verifying', 'live', 'superseded'])
    .default('confirmation-required'),
  receiptId: z.uuid().optional(),
});

export const experienceApprovalId = z.uuid();
export const experiencePreparationIntent = z.object({
  approvalId: experienceApprovalId,
  status: z.enum([
    'preparing',
    'confirmation-required',
    'applied',
    'verifying',
    'live',
    'superseded',
  ]),
  effectDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  proofExpiresAt: z.iso.datetime({ offset: true }).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
export const experiencePreparationResponse = z.object({
  approvalId: experienceApprovalId,
  status: z.enum(['preparing', 'ready', 'reconciled']),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
export const experienceLifecycleReceipt = z.record(z.string(), z.json());
export const experienceApprovalPageInput = z.object({
  approval: experienceApprovalId,
  kind: z.enum(['draft', 'lifecycle']).default('draft'),
});

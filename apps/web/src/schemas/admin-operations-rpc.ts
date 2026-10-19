import { z } from 'zod';
import { nullableAdminSafeErrorCodeSchema } from './admin-safe-error-code';

const optionalText = z.string().nullable();
const requiredText = z.string();
const count = z.number().int().nonnegative();
const money = z.number().finite();

const financialSchema = z.object({
  paymentSideEffects: z.array(
    z.object({
      attempts: count,
      claimedAt: optionalText,
      merchantId: requiredText,
      merchantName: requiredText,
      orderId: requiredText,
      status: requiredText,
      step: requiredText,
    })
  ),
  payouts: z.array(
    z.object({
      amount: money,
      createdAt: optionalText,
      currency: optionalText,
      id: requiredText,
      merchantId: requiredText,
      merchantName: requiredText,
      payoutMode: optionalText,
      processedAt: optionalText,
      status: optionalText,
    })
  ),
  reconciliationReview: z.array(
    z.object({
      createdAt: requiredText,
      id: requiredText,
      issueType: requiredText,
      merchantId: optionalText,
      merchantName: requiredText,
    })
  ),
  settlements: z.array(
    z.object({
      createdAt: optionalText,
      currency: optionalText,
      expectedSettlementDate: requiredText,
      gateway: requiredText,
      id: requiredText,
      merchantId: requiredText,
      merchantName: requiredText,
      netAmount: money.nullable(),
      status: requiredText,
    })
  ),
});

export const adminOperationsRpcSchema = z.object({
  financial: financialSchema,
  generatedAt: requiredText,
  notifications: z.object({
    email: z.array(
      z.strictObject({
        attemptCount: count,
        createdAt: requiredText,
        emailType: requiredText,
        id: requiredText,
        merchantId: optionalText,
        merchantName: requiredText,
        provider: requiredText,
        providerErrorCode: nullableAdminSafeErrorCodeSchema,
        status: z.enum(['failed', 'stale']),
      })
    ),
    orderOutbox: z.array(
      z.object({
        attemptCount: count,
        createdAt: requiredText,
        eventType: requiredText,
        id: requiredText,
        maxAttempts: count,
        merchantId: requiredText,
        merchantName: requiredText,
        orderId: requiredText,
        status: requiredText,
      })
    ),
    push: z.array(
      z.object({
        appType: requiredText,
        createdAt: requiredText,
        failedCount: count,
        id: requiredText,
        merchantId: optionalText,
        merchantName: requiredText,
        notificationType: optionalText,
        status: requiredText,
      })
    ),
    trackingOutbox: z.array(
      z.object({
        attemptCount: count,
        audience: requiredText,
        createdAt: requiredText,
        id: requiredText,
        merchantId: requiredText,
        merchantName: requiredText,
        notificationKind: requiredText,
        orderId: requiredText,
        status: requiredText,
      })
    ),
  }),
  shipping: z.object({
    shipments: z.array(
      z.object({
        id: requiredText,
        merchantId: requiredText,
        merchantName: requiredText,
        orderId: optionalText,
        provider: requiredText,
        status: requiredText,
        updatedAt: optionalText,
      })
    ),
    webhooks: z.array(
      z.strictObject({
        createdAt: optionalText,
        eventType: optionalText,
        id: requiredText,
        processed: z.boolean().nullable(),
        provider: requiredText,
        shipmentId: optionalText,
      })
    ),
  }),
  summary: z.object({
    notifications: count,
    paymentSideEffects: count,
    payouts: count,
    reconciliationReview: count,
    settlements: count,
    shipping: count,
    workers: count,
  }),
  workers: z.array(
    z.object({
      lastErrorAt: optionalText,
      lastErrorCode: nullableAdminSafeErrorCodeSchema,
      lastSucceededAt: optionalText,
      processedCount: count,
      state: z.enum(['healthy', 'stale', 'error']),
      updatedAt: requiredText,
      workerName: requiredText,
    })
  ),
});

export type AdminOperations = z.infer<typeof adminOperationsRpcSchema>;

export const adminOperationsApiSchema = adminOperationsRpcSchema.extend({
  capabilities: z.object({
    canReadFinancials: z.boolean(),
    canReplay: z.boolean(),
  }),
});

export type AdminOperationsApi = z.infer<typeof adminOperationsApiSchema>;

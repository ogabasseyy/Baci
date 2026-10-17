import { z } from 'zod';

export const billTypeEnum = z.enum([
  'airtime',
  'data',
  'electricity',
  'cable_tv',
  'betting',
]);
export type BillType = z.infer<typeof billTypeEnum>;

export const purchaseSchemaBase = z.object({
  merchantSlug: z.string().min(1),
  amount: z.number().min(50).max(500000),
  type: billTypeEnum,
  // Airtime/Data fields
  phoneNumber: z.string().optional(),
  networkProvider: z.string().optional(),
  dataPlanCode: z.string().optional(),
  // Bill payment fields (TV, Power, Betting)
  billItemIdentifier: z.string().optional(),
  customerIdentifier: z.string().optional(),
  billerName: z.string().optional(),
  // Bill customer info (electricity / cable / betting)
  customerName: z.string().min(1).optional(),
  // Meter/customer address captured at verify (validate-customer); persisted to
  // metadata so the receipt can show it.
  customerAddress: z.string().min(1).optional(),
  customerPhone: z.string().min(1).optional(),
  // Common optional fields
  customerId: z.uuid().optional(),
  orderId: z.uuid().optional(),
  source: z
    .enum(['checkout', 'loyalty_reward', 'direct', 'gift', 'storefront_modal'])
    .default('direct'),
  // Wallet payment leg. Optional; when present, the customer's wallet
  // covers `walletAmount` of the bill and the gateway charges
  // `amount - walletAmount` (residual). `walletAmount === amount` is the
  // wallet-only path. Cross-field rule (walletAmount <= amount) is in
  // applyPurchaseRequirements so every derived schema picks it up.
  walletAmount: z.number().nonnegative().optional(),
  // Monnify checkout additions
  provider: z.enum(['kuda', 'monnify']).optional(),
  validationReference: z.string().optional(),
  billerCode: z.string().optional(),
  productCode: z.string().optional(),
  requireValidationRef: z.boolean().optional(),
});

export type PurchaseRequirementValues = z.infer<typeof purchaseSchemaBase>;

export function applyPurchaseRequirements(
  data: PurchaseRequirementValues,
  ctx: z.RefinementCtx
) {
  if (data.type === 'airtime' || data.type === 'data') {
    if (!data.phoneNumber) {
      ctx.addIssue({
        code: 'custom',
        message: 'phoneNumber is required for airtime/data',
        path: ['phoneNumber'],
      });
    }

    if (!data.networkProvider) {
      ctx.addIssue({
        code: 'custom',
        message: 'networkProvider is required for airtime/data',
        path: ['networkProvider'],
      });
    }
  }

  if (data.type === 'data' && !data.dataPlanCode) {
    ctx.addIssue({
      code: 'custom',
      message: 'dataPlanCode is required for data purchases',
      path: ['dataPlanCode'],
    });
  }

  if (
    data.type === 'electricity' ||
    data.type === 'cable_tv' ||
    data.type === 'betting'
  ) {
    if (data.provider === 'monnify') {
      if (!data.billerCode) {
        ctx.addIssue({
          code: 'custom',
          message: 'billerCode is required for Monnify checkout',
          path: ['billerCode'],
        });
      }
      if (!data.productCode) {
        ctx.addIssue({
          code: 'custom',
          message: 'productCode is required for Monnify checkout',
          path: ['productCode'],
        });
      }
      if (!data.customerIdentifier) {
        ctx.addIssue({
          code: 'custom',
          message: 'customerIdentifier is required for Monnify checkout',
          path: ['customerIdentifier'],
        });
      }
      if (data.requireValidationRef && !data.validationReference) {
        ctx.addIssue({
          code: 'custom',
          message:
            'validationReference is required when requireValidationRef is true',
          path: ['validationReference'],
        });
      }
    } else if (data.provider === 'kuda') {
      if (!data.billItemIdentifier) {
        ctx.addIssue({
          code: 'custom',
          message: 'billItemIdentifier is required for Kuda checkout',
          path: ['billItemIdentifier'],
        });
      }
      if (!data.customerIdentifier) {
        ctx.addIssue({
          code: 'custom',
          message: 'customerIdentifier is required for Kuda checkout',
          path: ['customerIdentifier'],
        });
      }
    } else {
      // Auto mode: check if they are trying to use Monnify (has Monnify hints)
      const hasMonnifyHint = !!(data.billerCode || data.productCode);
      if (hasMonnifyHint) {
        if (!data.billerCode) {
          ctx.addIssue({
            code: 'custom',
            message: 'billerCode is required for Monnify checkout',
            path: ['billerCode'],
          });
        }
        if (!data.productCode) {
          ctx.addIssue({
            code: 'custom',
            message: 'productCode is required for Monnify checkout',
            path: ['productCode'],
          });
        }
        if (!data.customerIdentifier) {
          ctx.addIssue({
            code: 'custom',
            message: 'customerIdentifier is required for Monnify checkout',
            path: ['customerIdentifier'],
          });
        }
        if (data.requireValidationRef && !data.validationReference) {
          ctx.addIssue({
            code: 'custom',
            message:
              'validationReference is required when requireValidationRef is true',
            path: ['validationReference'],
          });
        }
      } else {
        // Default to Kuda requirements
        if (!data.billItemIdentifier) {
          ctx.addIssue({
            code: 'custom',
            message: 'billItemIdentifier is required for Kuda checkout',
            path: ['billItemIdentifier'],
          });
        }
        if (!data.customerIdentifier) {
          ctx.addIssue({
            code: 'custom',
            message: 'customerIdentifier is required for Kuda checkout',
            path: ['customerIdentifier'],
          });
        }
      }
    }
  }

  if (data.walletAmount !== undefined && data.walletAmount > data.amount) {
    ctx.addIssue({
      code: 'custom',
      message: 'walletAmount cannot exceed amount',
      path: ['walletAmount'],
    });
  }

  // Wallet credit is a customer-paid leg, only valid for the
  // `checkout` source. Loyalty rewards, gifts, direct purchases, and
  // the storefront modal are settled via different paths (merchant
  // pre-funding, gateway only, etc.) and the refund helper in
  // `vtu-fulfillment.ts:327` skips non-checkout rows — so a wallet
  // debit triggered by a non-checkout flow would leave the customer
  // permanently charged on a vend failure.
  if (
    data.walletAmount !== undefined &&
    data.walletAmount > 0 &&
    data.source !== 'checkout'
  ) {
    ctx.addIssue({
      code: 'custom',
      message: 'walletAmount is only valid for checkout-sourced purchases',
      path: ['walletAmount'],
    });
  }
}

export const purchaseSchema = purchaseSchemaBase.superRefine(
  applyPurchaseRequirements
);

export type PurchaseInput = z.infer<typeof purchaseSchema>;

export const verifySchema = z
  .object({
    customerIdentifier: z.string().min(1, 'Customer identifier is required'),
    provider: z.enum(['kuda', 'monnify']).default('kuda'),
    // Kuda-specific
    billItemIdentifier: z.string().optional(),
    // Monnify-specific
    billerCode: z.string().optional(),
    productCode: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.provider === 'monnify') {
      if (!data.billerCode) {
        ctx.addIssue({
          code: 'custom',
          message: 'billerCode is required for Monnify validation',
          path: ['billerCode'],
        });
      }
      if (!data.productCode) {
        ctx.addIssue({
          code: 'custom',
          message: 'productCode is required for Monnify validation',
          path: ['productCode'],
        });
      }
    } else if (!data.billItemIdentifier) {
      ctx.addIssue({
        code: 'custom',
        message: 'Bill item identifier is required',
        path: ['billItemIdentifier'],
      });
    }
  });

export type VerifyInput = z.infer<typeof verifySchema>;

export const billersQuerySchema = z.object({
  type: billTypeEnum,
  includeMonnify: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => value === 'true'),
});

export const historyQuerySchema = z.object({
  merchantSlug: z.string().min(1, 'Merchant slug is required'),
  type: billTypeEnum.optional(),
  limit: z.coerce.number().int().min(1).max(50).prefault(20),
  // Exact request_reference scope for voucher backfills: without it a
  // customer with 20+ newer rows of the type never sees the target.
  reference: z.string().min(1).optional(),
});

const vtuCheckoutGatewayEnum = z.enum(['paystack', 'korapay', 'bank_transfer']);

export const vtuCheckoutInitializeSchema = purchaseSchemaBase
  .extend({
    gateway: vtuCheckoutGatewayEnum,
  })
  .superRefine(applyPurchaseRequirements);

export const vtuCheckoutConfirmSchema = z.object({
  merchantSlug: z.string().min(1, 'Merchant slug is required'),
  gateway: z.enum(['paystack', 'korapay']),
  reference: z.string().min(1, 'Payment reference is required'),
});

export const vtuSavedPaymentMethodsQuerySchema = z.object({
  merchantSlug: z.string().min(1, 'Merchant slug is required'),
});

export const vtuSavedCardChargeSchema = purchaseSchemaBase
  .extend({
    gateway: vtuCheckoutGatewayEnum,
    savedPaymentMethodId: z.uuid('Saved payment method id is invalid'),
  })
  .superRefine(applyPurchaseRequirements);

export { COMMISSION_CATEGORY_MAP } from './vtu-commission';

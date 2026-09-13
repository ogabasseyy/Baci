import { z } from 'zod';
import {
  sanitizeWalletReturnTo,
  type WalletReturnHref,
} from '@/lib/sanitize-wallet-return-to';

const trimmedRequiredString = (message: string) =>
  z.string().trim().min(1, message);

const trimmedOptionalString = (message: string) =>
  trimmedRequiredString(message).optional();

const optionalOrderIdentifier = z.string().trim().optional();
const optionalTrackingToken = z.string().trim().optional();

const sanitizedReturnTo = z.preprocess(
  (value) => {
    return sanitizeWalletReturnTo(value);
  },
  z
    .string()
    .transform((value) => value as WalletReturnHref)
    .optional()
);

const optionalPositiveAmount = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.coerce
    .number({ message: 'Amount must be a valid number' })
    .finite('Amount cannot be Infinity or NaN')
    .positive('Amount must be greater than 0')
    .optional()
);

const paymentGatewayParamsObject = z.object({
  orderId: optionalOrderIdentifier,
  orderNumber: optionalOrderIdentifier,
  gateway: z.enum(['paystack', 'korapay', 'juicyway'], {
    message: 'Invalid payment gateway',
  }),
  authorizationUrl: trimmedRequiredString('Authorization URL is required').url(
    'Invalid authorization URL'
  ),
  reference: trimmedRequiredString('Reference is required'),
  amount: optionalPositiveAmount,
  paymentKind: z
    .enum(['order', 'vtu', 'wallet', 'savings_auth'])
    .default('order'),
  paymentMethod: z.literal('uba_redvault').optional(),
  returnTo: sanitizedReturnTo,
  merchantId: trimmedOptionalString('Merchant id cannot be empty'),
  merchantSlug: trimmedOptionalString('Merchant slug cannot be empty'),
  trackingToken: optionalTrackingToken,
  utilityType: z.enum(['airtime', 'data', 'tv', 'power', 'gaming']).optional(),
  customerIdentifier: trimmedOptionalString(
    'Customer identifier cannot be empty'
  ),
});

export const PaymentGatewayParamsSchema = paymentGatewayParamsObject
  .superRefine((data, ctx) => {
    if (
      data.paymentMethod === 'uba_redvault' &&
      (data.gateway !== 'paystack' ||
        data.paymentKind !== 'order' ||
        !data.orderId)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid UBA payment context',
        path: ['paymentMethod'],
      });
    }
    if (data.paymentKind === 'vtu') {
      if (!data.utilityType) {
        ctx.addIssue({
          code: 'custom',
          message: 'Utility type is required for VTU payments',
          path: ['utilityType'],
        });
      }

      if (!data.customerIdentifier) {
        ctx.addIssue({
          code: 'custom',
          message: 'Customer identifier is required for VTU payments',
          path: ['customerIdentifier'],
        });
      }
      return;
    }

    if (data.paymentKind === 'wallet') {
      if (data.amount === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'Amount is required for wallet top-up payments',
          path: ['amount'],
        });
      }
      if (!data.merchantId && !data.merchantSlug) {
        ctx.addIssue({
          code: 'custom',
          message: 'Merchant slug or id is required',
          path: ['merchantSlug'],
        });
      }
      return;
    }

    if (data.paymentKind === 'savings_auth') {
      // Savings card authorization requires only gateway fields, not order or amount context.
      return;
    }

    if (data.orderId === '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Order ID cannot be empty',
        path: ['orderId'],
      });
    }

    if (data.orderNumber === '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Order number cannot be empty',
        path: ['orderNumber'],
      });
    }

    if (data.orderId === undefined && data.orderNumber === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Order ID or order number is required for order payments',
        path: ['orderId'],
      });
    }
  })
  .transform((data) =>
    data.paymentKind === 'wallet' || data.paymentKind === 'savings_auth'
      ? data
      : { ...data, returnTo: undefined }
  );

export type PaymentGatewayParams = z.infer<typeof PaymentGatewayParamsSchema>;

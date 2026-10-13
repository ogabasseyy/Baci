import { z } from 'zod';
import {
  sanitizeWalletReturnTo,
  type WalletReturnHref,
} from '@/lib/sanitize-wallet-return-to';
import { PRIMARY_WALLET_CARD_PAYSTACK_CHECKOUT_HOSTNAME } from '@/schemas/primary-wallet-card';

const trimmedRequiredString = (message: string) =>
  z.string().trim().min(1, message);

const trimmedOptionalString = (message: string) =>
  trimmedRequiredString(message).optional();

const optionalOrderIdentifier = z.string().trim().optional();
const optionalTrackingToken = z.string().trim().optional();

// Hostname-checked parsing instead of a tight path regex: the provider may
// add path segments, hyphens, or query strings to a legitimate checkout URL.
function isPaystackCheckoutUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname === PRIMARY_WALLET_CARD_PAYSTACK_CHECKOUT_HOSTNAME
    );
  } catch {
    return false;
  }
}

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

// Canonical order total (full order value incl. credits covered server-side).
// Distinct from `amount`, which is the residual due at the gateway.
const optionalOrderTotal = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.coerce
    .number({ message: 'Order total must be a valid number' })
    .finite('Order total cannot be Infinity or NaN')
    .min(0, 'Order total cannot be negative')
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
  orderTotal: optionalOrderTotal,
  paymentKind: z
    .enum(['order', 'vtu', 'wallet', 'savings_auth', 'primary_wallet_card'])
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
  // Initiating-user bind for primary card checkout: the fund flow stamps
  // the user it guarded, so the mounted screen can block the WebView when
  // a later account switch would otherwise let another user enter card
  // details into the previous account's charge. Absent on legacy links,
  // where only the completion-time ownership guard applies.
  userId: z.uuid().optional(),
});

export const PaymentGatewayParamsSchema = paymentGatewayParamsObject
  .superRefine((data, ctx) => {
    if (
      data.reference.startsWith('pvb-first-primary-') &&
      data.paymentKind !== 'primary_wallet_card'
    )
      ctx.addIssue({
        code: 'custom',
        path: ['paymentKind'],
        message: 'Primary card references cannot use legacy confirmation',
      });
    if (data.paymentKind === 'primary_wallet_card') {
      if (
        data.gateway !== 'paystack' ||
        !z.uuid().safeParse(data.merchantId).success ||
        !/^pvb-first-primary-[0-9a-f-]{36}$/.test(data.reference) ||
        !z.uuid().safeParse(data.reference.slice('pvb-first-primary-'.length))
          .success ||
        !isPaystackCheckoutUrl(data.authorizationUrl) ||
        data.amount === undefined
      )
        ctx.addIssue({
          code: 'custom',
          path: ['paymentKind'],
          message: 'Invalid primary wallet card context',
        });
      return;
    }
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
    data.paymentKind === 'wallet' ||
    data.paymentKind === 'savings_auth' ||
    data.paymentKind === 'primary_wallet_card'
      ? data
      : { ...data, returnTo: undefined }
  );

export type PaymentGatewayParams = z.infer<typeof PaymentGatewayParamsSchema>;

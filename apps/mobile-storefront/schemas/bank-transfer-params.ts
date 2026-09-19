import { z } from 'zod';

const requiredTrimmedString = (message: string) =>
  z.string({ error: message }).trim().min(1, message);

const optionalMoney = (message: string) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.coerce
      .number({ message })
      .finite('Value cannot be Infinity or NaN')
      .min(0, 'Value cannot be negative')
      .optional()
  );

const BankTransferBaseParamsSchema = z.object({
  accountName: requiredTrimmedString('Account name is required'),
  accountNumber: requiredTrimmedString('Account number is required'),
  amount: requiredTrimmedString('Amount is required'),
  bankName: requiredTrimmedString('Bank name is required'),
  orderId: requiredTrimmedString('Order ID is required'),
  orderNumber: z.string().optional(),
  // Canonical full order value; `amount` is only the residual due after
  // wallet balance and must not be reported as purchase revenue.
  orderTotal: optionalMoney('Order total must be a valid number'),
  // Checkout attribution snapshot: the wallet-funded completion wins the
  // durable claim after the cart may clear, so identity and breakdown that
  // the success screen can no longer enrich travel on the route instead.
  customerEmail: z.string().trim().optional(),
  customerPhone: z.string().trim().optional(),
  subtotal: optionalMoney('Subtotal must be a valid number'),
  shipping: optionalMoney('Shipping must be a valid number'),
  tax: optionalMoney('Tax must be a valid number'),
  trackingToken: z.string().trim().optional(),
});

export const BankTransferParamsSchema = BankTransferBaseParamsSchema.extend({
  reference: requiredTrimmedString('Reference is required'),
});

export const WalletFundedBankTransferParamsSchema =
  BankTransferBaseParamsSchema.extend({
    intentId: requiredTrimmedString('Intent ID is required'),
    merchantId: z.string().trim().optional(),
    merchantSlug: z.string().trim().optional(),
    walletFunded: z.string().optional(),
  });

export type BankTransferParams = z.infer<typeof BankTransferParamsSchema>;
export type WalletFundedBankTransferParams = z.infer<
  typeof WalletFundedBankTransferParamsSchema
>;

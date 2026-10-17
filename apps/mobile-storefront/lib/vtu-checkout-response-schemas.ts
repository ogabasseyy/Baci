import { z } from 'zod';

const ConfirmationGatewayEnum = z.enum(['paystack', 'korapay']);

export const ConfirmCheckoutResponseSchema = z.object({
  success: z.boolean().optional(),
  status: z.enum(['successful', 'processing']),
  reference: z.string(),
  amount: z.number().optional(),
  customerIdentifier: z.string().optional(),
  voucherPin: z.string().optional(),
  cashback: z
    .object({
      amount: z.number(),
      credited: z.boolean(),
      newBalance: z.number(),
    })
    .optional(),
});

const SavedCardSchema = z.object({
  id: z.string(),
  provider: z.literal('paystack'),
  label: z.string(),
  brand: z.string().nullable(),
  bank: z.string().nullable(),
  last4: z.string().nullable(),
  exp_month: z.string().nullable(),
  exp_year: z.string().nullable(),
  is_default: z.boolean(),
});

export const SavedCardsResponseSchema = z.object({
  cards: z.array(SavedCardSchema),
});

export const WalletOnlyVtuResponseSchema = z.object({
  status: z.enum(['successful', 'processing']),
  reference: z.string(),
  amount: z.number().optional(),
  customerIdentifier: z.string().optional(),
  voucherPin: z.string().optional(),
  cashback: z
    .object({
      amount: z.number(),
      credited: z.boolean(),
      newBalance: z.number(),
    })
    .optional(),
});

export type VtuConfirmationGateway = z.infer<typeof ConfirmationGatewayEnum>;
export type VtuCheckoutConfirmation = z.infer<
  typeof ConfirmCheckoutResponseSchema
>;
export type SavedVtuCard = z.infer<typeof SavedCardSchema>;
export type WalletOnlyVtuResult = z.infer<typeof WalletOnlyVtuResponseSchema>;

export interface VTUCheckoutPayload {
  amount: number;
  billItemIdentifier?: string;
  billerCode?: string;
  billerName?: string;
  customerIdentifier?: string;
  customerName?: string;
  customerAddress?: string;
  customerPhone?: string;
  dataPlanCode?: string;
  networkProvider?: string;
  phoneNumber?: string;
  productCode?: string;
  provider?: 'kuda' | 'monnify';
  requireValidationRef?: boolean;
  type: 'airtime' | 'data' | 'electricity' | 'cable_tv' | 'betting';
  validationReference?: string;
  walletAmount?: number;
}

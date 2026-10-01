import { z } from 'zod';

const REDVAULT_CARD_BRANDS = ['verve', 'visa', 'mastercard'] as const;

export const redvaultProviderCaptureSchema = z.object({
  amount: z.number().int().positive(),
  authorization: z
    .object({
      brand: z.string().nullable().optional(),
      channel: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  currency: z.string().min(1),
  reference: z.string().min(1),
  status: z.string().min(1),
});

const paystackVerifyResponseSchema = z.object({
  data: z.object({
    amount: z.number().int().positive(),
    authorization: z.object({
      bank: z.string().min(1),
      brand: z.string().min(1),
      channel: z.string().min(1),
    }),
    channel: z.string().min(1),
    currency: z.string().min(1),
    customer: z.object({ email: z.string().email() }),
    domain: z.string().min(1),
    id: z.union([z.number().int().positive(), z.string().min(1)]),
    paid_at: z.string().datetime(),
    reference: z.string().min(1),
    status: z.literal('success'),
  }),
  status: z.literal(true),
});

export type RedvaultProviderCapture = z.infer<
  typeof redvaultProviderCaptureSchema
>;

export type RedvaultVerifiedPaymentEvidence = {
  acceptedFilterPolicyHash: string;
  amountKobo: number;
  cardBrand: (typeof REDVAULT_CARD_BRANDS)[number];
  cardChannel: 'card';
  contractVersion: 'paystack_verified_card_v1';
  currency: string;
  customerEmail: string;
  domain: string;
  issuerName: string;
  providerVerificationId: string;
  reference: string;
  verificationSource: 'paystack_transaction_verify';
  verifiedAt: string;
};

export function createRedvaultPaystackMetadata(bankCode: string) {
  if (!/^\d{3}$/.test(bankCode)) {
    throw new Error('REDVAULT Paystack bank filter is not configured');
  }
  return {
    custom_filters: {
      banks: [bankCode],
      card_brands: [...REDVAULT_CARD_BRANDS],
    },
    partnership: 'uba_redvault',
  };
}

export function evaluateRedvaultCapture({
  capture,
  expectedAmountKobo,
  expectedCurrency,
  expectedReference,
}: {
  capture: RedvaultProviderCapture;
  expectedAmountKobo: number;
  expectedCurrency: string;
  expectedReference: string;
}): 'approved' | 'held' {
  if (
    capture.status !== 'success' ||
    capture.reference !== expectedReference ||
    capture.amount !== expectedAmountKobo ||
    capture.currency.toUpperCase() !== expectedCurrency.toUpperCase() ||
    capture.authorization?.channel !== 'card' ||
    !REDVAULT_CARD_BRANDS.includes(
      capture.authorization?.brand?.toLowerCase() as (typeof REDVAULT_CARD_BRANDS)[number]
    )
  ) {
    return 'held';
  }

  return 'held';
}

export function createRedvaultVerifiedPaymentEvidence({
  acceptedFilterPolicyHash,
  expectedAmountKobo,
  expectedCurrency,
  expectedCustomerEmail,
  expectedDomain,
  expectedIssuerName,
  expectedReference,
  verifyResponse,
}: {
  acceptedFilterPolicyHash: string;
  expectedAmountKobo: number;
  expectedCurrency: string;
  expectedCustomerEmail: string;
  expectedDomain: 'live' | 'test';
  expectedIssuerName: string;
  expectedReference: string;
  verifyResponse: unknown;
}): RedvaultVerifiedPaymentEvidence | null {
  const parsed = paystackVerifyResponseSchema.safeParse(verifyResponse);
  if (
    !parsed.success ||
    !/^[0-9a-f]{64}$/.test(acceptedFilterPolicyHash) ||
    parsed.data.data.amount !== expectedAmountKobo ||
    parsed.data.data.currency.toUpperCase() !==
      expectedCurrency.toUpperCase() ||
    parsed.data.data.reference !== expectedReference ||
    parsed.data.data.domain !== expectedDomain ||
    parsed.data.data.channel !== 'card' ||
    parsed.data.data.authorization.channel !== 'card' ||
    parsed.data.data.authorization.bank !== expectedIssuerName ||
    parsed.data.data.customer.email.trim().toLowerCase() !==
      expectedCustomerEmail.trim().toLowerCase()
  ) {
    return null;
  }

  const cardBrand = parsed.data.data.authorization.brand.toLowerCase();
  if (
    !REDVAULT_CARD_BRANDS.includes(
      cardBrand as (typeof REDVAULT_CARD_BRANDS)[number]
    )
  ) {
    return null;
  }

  return {
    acceptedFilterPolicyHash,
    amountKobo: parsed.data.data.amount,
    cardBrand: cardBrand as (typeof REDVAULT_CARD_BRANDS)[number],
    cardChannel: 'card',
    contractVersion: 'paystack_verified_card_v1',
    currency: parsed.data.data.currency.toUpperCase(),
    customerEmail: parsed.data.data.customer.email.trim().toLowerCase(),
    domain: parsed.data.data.domain,
    issuerName: parsed.data.data.authorization.bank,
    providerVerificationId: String(parsed.data.data.id),
    reference: parsed.data.data.reference,
    verificationSource: 'paystack_transaction_verify',
    verifiedAt: parsed.data.data.paid_at,
  };
}

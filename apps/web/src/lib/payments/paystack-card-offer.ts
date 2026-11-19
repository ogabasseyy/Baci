import { z } from 'zod';
import type { PaystackBankOfferCardBrand } from '@/schemas/bank-card-offer';

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

export type PaystackVerifiedCardEvidence = {
  acceptedFilterPolicyHash: string;
  amountKobo: number;
  cardBrand: PaystackBankOfferCardBrand;
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

export function createPaystackCardOfferMetadata<Partnership extends string>({
  partnership,
  bankCode,
  cardBrands,
}: {
  partnership: Partnership;
  bankCode: string;
  cardBrands: readonly PaystackBankOfferCardBrand[];
}) {
  if (!/^\d{3}$/.test(bankCode) || cardBrands.length === 0) {
    throw new Error('Paystack bank or card brand filter is not configured');
  }
  return {
    custom_filters: { banks: [bankCode], card_brands: [...cardBrands] },
    partnership,
  };
}

export function verifyPaystackCardOffer({
  acceptedFilterPolicyHash,
  cardBrands,
  expectedAmountKobo,
  expectedCurrency,
  expectedCustomerEmail,
  expectedDomain,
  expectedIssuerName,
  expectedReference,
  verifyResponse,
}: {
  acceptedFilterPolicyHash: string;
  cardBrands: readonly PaystackBankOfferCardBrand[];
  expectedAmountKobo: number;
  expectedCurrency: string;
  expectedCustomerEmail: string;
  expectedDomain: 'live' | 'test';
  expectedIssuerName: string;
  expectedReference: string;
  verifyResponse: unknown;
}): PaystackVerifiedCardEvidence | null {
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
    parsed.data.data.authorization.bank.trim().toUpperCase() !==
      expectedIssuerName.trim().toUpperCase() ||
    parsed.data.data.customer.email.trim().toLowerCase() !==
      expectedCustomerEmail.trim().toLowerCase()
  ) {
    return null;
  }

  const cardBrand = cardBrands.find(
    (brand) => brand === parsed.data.data.authorization.brand.toLowerCase()
  );
  if (!cardBrand) {
    return null;
  }

  return {
    acceptedFilterPolicyHash,
    amountKobo: parsed.data.data.amount,
    cardBrand,
    cardChannel: 'card',
    contractVersion: 'paystack_verified_card_v1',
    currency: parsed.data.data.currency.toUpperCase(),
    customerEmail: parsed.data.data.customer.email.trim().toLowerCase(),
    domain: parsed.data.data.domain,
    issuerName: expectedIssuerName.trim(),
    providerVerificationId: String(parsed.data.data.id),
    reference: parsed.data.data.reference,
    verificationSource: 'paystack_transaction_verify',
    verifiedAt: parsed.data.data.paid_at,
  };
}

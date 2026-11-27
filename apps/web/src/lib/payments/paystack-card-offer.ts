import type { PaystackBankOfferCardBrand } from '@/schemas/bank-card-offer';
import { paystackVerifyResponseSchema } from '@/schemas/paystack-card-offer-verification';
import { matchBankCardOfferIssuer } from './match-bank-card-offer-issuer';

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

export function verifyPaystackCardOffer({
  acceptedFilterPolicyHash,
  cardBrands,
  expectedAmountKobo,
  expectedCurrency,
  expectedCustomerEmail,
  expectedDomain,
  expectedIssuerName,
  expectedBankCode,
  expectedReference,
  onIssuerMismatch,
  verifyResponse,
}: {
  acceptedFilterPolicyHash: string;
  cardBrands: readonly PaystackBankOfferCardBrand[];
  expectedAmountKobo: number;
  expectedCurrency: string;
  expectedCustomerEmail: string;
  expectedDomain: 'live' | 'test';
  expectedIssuerName: string;
  expectedBankCode?: Parameters<typeof matchBankCardOfferIssuer>[0];
  expectedReference: string;
  onIssuerMismatch?: (issuer: string) => void;
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
    parsed.data.data.customer.email.trim().toLowerCase() !==
      expectedCustomerEmail.trim().toLowerCase()
  ) {
    return null;
  }

  const providerIssuer = parsed.data.data.authorization.bank;
  const issuerMatches = expectedBankCode
    ? matchBankCardOfferIssuer(
        expectedBankCode,
        expectedIssuerName,
        providerIssuer
      )
    : providerIssuer.trim().toUpperCase() ===
      expectedIssuerName.trim().toUpperCase();
  if (!issuerMatches) {
    onIssuerMismatch?.(providerIssuer);
    return null;
  }

  const providerBrand = parsed.data.data.authorization.brand
    .trim()
    .toLowerCase();
  const cardBrand = cardBrands.find((brand) => brand === providerBrand);
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

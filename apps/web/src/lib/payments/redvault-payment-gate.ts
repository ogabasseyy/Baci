import { z } from 'zod';
import { createPaystackCardOfferMetadata } from './create-paystack-card-offer-metadata';
import {
  type PaystackVerifiedCardEvidence,
  verifyPaystackCardOffer,
} from './paystack-card-offer';

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

export type RedvaultProviderCapture = z.infer<
  typeof redvaultProviderCaptureSchema
>;

export function createRedvaultPaystackMetadata(bankCode: string) {
  if (!/^\d{3}$/.test(bankCode)) {
    throw new Error('REDVAULT Paystack bank filter is not configured');
  }
  return createPaystackCardOfferMetadata({
    bankCode,
    cardBrands: REDVAULT_CARD_BRANDS,
    partnership: 'uba_redvault',
  });
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

export type RedvaultVerifiedPaymentEvidence = PaystackVerifiedCardEvidence;

export function createRedvaultVerifiedPaymentEvidence(
  input: Omit<Parameters<typeof verifyPaystackCardOffer>[0], 'cardBrands'>
): RedvaultVerifiedPaymentEvidence | null {
  return verifyPaystackCardOffer({
    ...input,
    cardBrands: REDVAULT_CARD_BRANDS,
  });
}

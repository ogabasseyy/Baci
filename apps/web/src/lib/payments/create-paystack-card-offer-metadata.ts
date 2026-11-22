import type { PaystackBankOfferCardBrand } from '@/schemas/bank-card-offer';

export function createPaystackCardOfferMetadata<Partnership extends string>({
  partnership,
  bankCode,
  cardBrands,
}: {
  partnership: Partnership;
  bankCode: string;
  cardBrands: readonly PaystackBankOfferCardBrand[];
}) {
  if (
    !/^\d{3}$/.test(bankCode) ||
    cardBrands.length === 0 ||
    new Set(cardBrands).size !== cardBrands.length
  ) {
    throw new Error('Paystack bank or card brand filter is not configured');
  }
  return {
    custom_filters: { banks: [bankCode], card_brands: [...cardBrands] },
    partnership,
  };
}

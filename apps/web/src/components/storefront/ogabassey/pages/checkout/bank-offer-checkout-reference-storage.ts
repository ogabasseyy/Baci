import { BANK_CARD_OFFER_REFERENCE_PATTERN } from '@baci/shared/constants';

const BANK_OFFER_REFERENCE_STORAGE_KEY = 'storefront-checkout-bank-offer-reference';

export const bankOfferCheckoutReferenceStorage = {
  write(
  merchantId: string,
  orderId: string,
  reference: string
): void {
  if (!BANK_CARD_OFFER_REFERENCE_PATTERN.test(reference)) {
    throw new Error('Invalid bank card offer payment reference');
  }
  window.sessionStorage.setItem(
    BANK_OFFER_REFERENCE_STORAGE_KEY,
    JSON.stringify([merchantId, orderId, reference])
  );
  },

  read(
  merchantId: string,
  orderId: string
): string | null {
  try {
    const saved: unknown = JSON.parse(
      window.sessionStorage.getItem(BANK_OFFER_REFERENCE_STORAGE_KEY) ?? 'null'
    );
    if (!Array.isArray(saved)) return null;
    const [savedMerchant, savedOrder, reference] = saved;
    return savedMerchant === merchantId &&
      savedOrder === orderId &&
      typeof reference === 'string' &&
      BANK_CARD_OFFER_REFERENCE_PATTERN.test(reference)
      ? reference
      : null;
  } catch {
    return null;
  }
  },
};

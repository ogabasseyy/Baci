import type { CreditDirectWebhookPayload } from '@/lib/credit-direct';

export function readProductAmount(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim()) {
    const amount = Number(value.trim());
    return Number.isFinite(amount) ? amount : null;
  }

  return null;
}

export function getWebhookProductsTotal(
  products: CreditDirectWebhookPayload['products']
) {
  let total = 0;

  for (const product of products) {
    const amount = readProductAmount(product.productAmount);
    if (amount === null) {
      return null;
    }
    total += amount;
  }

  return total;
}

export function getWebhookWalletProductsTotal(
  products: CreditDirectWebhookPayload['products']
) {
  let totalKobo = 0;
  for (const product of products) {
    const amount = readProductAmount(product.productAmount);
    if (amount === null || amount < 0) return null;

    const kobo = Math.round(amount * 100);
    if (!Number.isSafeInteger(kobo) || kobo / 100 !== amount) return null;
    totalKobo += kobo;
    if (!Number.isSafeInteger(totalKobo)) return null;
  }
  return totalKobo / 100;
}

export function matchesRecordedFinancedAmount(
  products: CreditDirectWebhookPayload['products'],
  recordedAmount: number
): boolean {
  // The recorded fee split can include fractional kobo before summation.
  return (
    getWebhookWalletProductsTotal(products) ===
    Math.round(recordedAmount * 100) / 100
  );
}

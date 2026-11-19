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

type WalletProductAmounts = readonly { productAmount: number | string }[];

function getWebhookWalletProductsKobo(products: WalletProductAmounts) {
  let totalKobo = 0;
  for (const product of products) {
    const decimal = String(product.productAmount).trim();
    const parts = /^(\d+)(?:\.(\d{1,2})0*)?$/.exec(decimal);
    if (!parts) return null;

    const kobo =
      Number(parts[1]) * 100 + Number((parts[2] ?? '').padEnd(2, '0'));
    if (!Number.isSafeInteger(kobo)) return null;
    totalKobo += kobo;
    if (!Number.isSafeInteger(totalKobo)) return null;
  }
  return totalKobo;
}

export function getWebhookWalletProductsTotal(products: WalletProductAmounts) {
  const kobo = getWebhookWalletProductsKobo(products);
  return kobo === null ? null : kobo / 100;
}

export function matchesRecordedFinancedAmount(
  products: WalletProductAmounts,
  recordedAmount: number
): boolean {
  // The recorded fee split can include fractional kobo before summation.
  const recordedKobo = Math.round(recordedAmount * 100);
  return (
    Number.isSafeInteger(recordedKobo) &&
    recordedKobo > 0 &&
    getWebhookWalletProductsKobo(products) === recordedKobo
  );
}

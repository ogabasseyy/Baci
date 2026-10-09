import { PRIMARY_WALLET_CARD_MIN_AMOUNT_KOBO } from '@/schemas/primary-wallet-card';

const MAX_FUND_AMOUNT_KOBO = 9999999999;

export function parseFundAmountKobo(fundAmount: unknown): number | null {
  if (typeof fundAmount !== 'string') return null;
  // Normalize display/user input (surrounding whitespace, thousands
  // separators), then require a plain shape: digits with at most two
  // decimals. Bare Number() would also accept exponents, hex, and signs,
  // which must never silently become a charge amount.
  const normalized = fundAmount.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  // Integer-only conversion: the shape above guarantees digits with at most
  // two decimals, so scale by string splitting — never a float multiply.
  const [whole, fraction = ''] = normalized.split('.');
  const amountKobo = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(amountKobo) ? amountKobo : null;
}

export function validateFundAmountKobo(
  fundAmount: unknown
): { amountKobo: number } | { error: string } {
  const amountKobo = parseFundAmountKobo(fundAmount);
  if (amountKobo === null) {
    const text =
      typeof fundAmount === 'string' ? fundAmount.trim().replace(/,/g, '') : '';
    if (text === '') return { error: 'Enter an amount greater than zero.' };
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric <= 0)
      return { error: 'Enter an amount greater than zero.' };
    if (Number.isFinite(numeric))
      return {
        error: 'Enter an amount with no more than two decimal places.',
      };
    return { error: 'Enter a valid amount using digits only.' };
  }
  if (amountKobo <= 0) return { error: 'Enter an amount greater than zero.' };
  // Same floor as the charge schema: failing here shows a specific
  // correctable error before consent instead of a generic
  // retained-operation message after it.
  if (amountKobo < PRIMARY_WALLET_CARD_MIN_AMOUNT_KOBO)
    return { error: 'Enter an amount of at least ₦50.00.' };
  if (amountKobo > MAX_FUND_AMOUNT_KOBO)
    return { error: 'Enter a smaller amount.' };
  return { amountKobo };
}

import type { GPTTotal } from './checkout';

export function getCheckoutGrandTotal(totals: GPTTotal[]): number {
  const amount = totals.find((total) => total.type === 'total')?.amount;
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Missing or invalid total amount');
    }
    return amount;
  }

  if (typeof amount === 'string' && /^\d+(?:\.\d+)?$/.test(amount)) {
    const parsed = Number(amount);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }

  throw new Error('Missing or invalid total amount');
}

const naira = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatPiggyvestPurchaseMoney(amount: number): string {
  if (!Number.isSafeInteger(amount) || amount < 0)
    throw new Error('Amount unavailable');
  const kobo = BigInt(amount);
  return `${naira.format(kobo / BigInt(100))}.${String(kobo % BigInt(100)).padStart(2, '0')}`;
}

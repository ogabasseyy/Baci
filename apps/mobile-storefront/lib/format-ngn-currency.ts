const NGN_WHOLE_FORMATTER = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 0,
});

// Kobo amounts always show two decimals, so ₦369.5 reads as ₦369.50.
const NGN_KOBO_FORMATTER = new Intl.NumberFormat('en-NG', {
  style: 'currency',
  currency: 'NGN',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatNgnCurrency(amount: number): string {
  // A bad snapshot or arithmetic slip must never render "₦NaN".
  if (!Number.isFinite(amount)) return '—';
  return Number.isInteger(amount)
    ? NGN_WHOLE_FORMATTER.format(amount)
    : NGN_KOBO_FORMATTER.format(amount);
}

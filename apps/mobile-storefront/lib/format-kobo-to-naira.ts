/**
 * Format integer kobo as a naira string with two fraction digits
 * (e.g. 9500000 -> "₦95,000.00").
 */
export function formatKoboToNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

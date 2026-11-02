/** Integer kobo to "₦1,234,567.89" without floating point. */
export function formatNaira(amountKobo: number): string {
  const naira = Math.trunc(amountKobo / 100);
  const kobo = amountKobo % 100;
  const grouped = naira.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₦${grouped}.${kobo.toString().padStart(2, '0')}`;
}

/** The database can serialize its bigint result as a number or decimal text. */
export function parseBankOfferRefundableKobo(value: unknown): number | null {
  const amount =
    typeof value === 'string' && /^[1-9][0-9]{0,15}$/.test(value)
      ? Number(value)
      : value;
  return typeof amount === 'number' &&
    Number.isSafeInteger(amount) &&
    amount > 0
    ? amount
    : null;
}

/** Keep repeated locality fields out of the carrier street while preserving
 * the explicitly confirmed destination, casing and coordinates. */
export function checkoutRecoveryStreetAddress(
  address: string,
  city: string,
  state: string
): string {
  const parts = address.split(',');
  const normalize = (value: string | undefined) =>
    (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  if (
    parts.length > 2 &&
    normalize(parts.at(-2)) === normalize(city) &&
    normalize(parts.at(-1)) === normalize(state)
  ) {
    return parts.slice(0, -2).join(',').trim();
  }
  return address;
}

export function isBaciPaystackSettlementCountry(
  country: string | null | undefined
): boolean {
  const normalizedCountry = country?.trim().toUpperCase();
  return (
    normalizedCountry === undefined ||
    normalizedCountry === '' ||
    normalizedCountry === 'NG'
  );
}

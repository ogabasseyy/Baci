/** Merchant country determines payment locality, independently of the phone prefix. */
export function buildCheckoutBillingAddress(line1: string, city: string, state: string, merchantCountry: string) {
  return { line1, city: city || 'Lagos', state: state || 'Lagos', country: merchantCountry, zip_code: merchantCountry === 'NG' ? '100001' : undefined };
}

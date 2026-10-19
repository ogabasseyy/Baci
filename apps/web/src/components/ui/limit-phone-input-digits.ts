const E164_MAX_DIGITS = 15;
const NIGERIAN_MOBILE_MAX_DIGITS = 13;

export function limitPhoneInputDigits(value: string): string {
  // Only remove Nigeria's national trunk prefix immediately after +234.
  // Never search the subscriber number for a zero or alter Italy's prefix.
  const normalized = value.replace(/^(\+234\s*)0/, '$1');
  const digits = normalized.replace(/\D/g, '');
  const isInternational = normalized.startsWith('+');
  // Nigerian mobile numbers have ten national digits. Leave fixed lines and
  // other countries to the phone library's country-specific length rules.
  const isNigerianMobile = isInternational && /^234[789]/.test(digits);
  const maxDigits = isNigerianMobile
    ? NIGERIAN_MOBILE_MAX_DIGITS
    : E164_MAX_DIGITS;
  let count = 0;
  for (let index = 0; index < normalized.length; index++) {
    if (/\d/.test(normalized[index])) {
      count++;
      if (count > maxDigits) return normalized.slice(0, index).trimEnd();
    }
  }
  return normalized;
}

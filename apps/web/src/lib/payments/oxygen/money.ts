/**
 * Exact NGN major/minor-unit conversion for the Oxygen money contract.
 *
 * Inside Oxygen orchestration, money is integer minor units (kobo). These
 * helpers convert at Baci boundaries only: database/API major amounts (NGN)
 * to minor units and back. Conversion involving provider amounts is blocked on
 * CR-06 (Oxygen's amount unit is unconfirmed) and is intentionally absent.
 *
 * Fail-closed: excess precision is rejected, never rounded; only NGN is
 * accepted; values outside the safe-integer range are rejected.
 */

const NGN_CURRENCY = 'NGN';
const MINOR_UNITS_PER_MAJOR = 100n;
const MAJOR_AMOUNT_PATTERN = /^(\d+)(?:\.(\d{1,2}))?$/;

function assertNgnCurrency(currency: string): void {
  if (currency.trim().toUpperCase() !== NGN_CURRENCY) {
    throw new Error('Oxygen amounts support NGN only');
  }
}

export function toOxygenMinorUnits(
  amountMajor: number | string,
  currency: string
): number {
  assertNgnCurrency(currency);
  const text =
    typeof amountMajor === 'string' ? amountMajor.trim() : String(amountMajor);
  const match = MAJOR_AMOUNT_PATTERN.exec(text);
  if (!match) {
    throw new Error(
      'Oxygen major amount must be a non-negative decimal with at most 2 places'
    );
  }
  const minor =
    BigInt(match[1]) * MINOR_UNITS_PER_MAJOR +
    BigInt((match[2] ?? '0').padEnd(2, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Oxygen amount exceeds the maximum supported value');
  }
  return Number(minor);
}

export function fromOxygenMinorUnits(
  amountMinor: number,
  currency: string
): string {
  assertNgnCurrency(currency);
  if (
    !Number.isInteger(amountMinor) ||
    amountMinor < 0 ||
    amountMinor > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error('Oxygen minor amount must be a non-negative safe integer');
  }
  // Return decimal text: Number division can lose a kobo near MAX_SAFE_INTEGER.
  const minor = BigInt(amountMinor);
  const major = minor / MINOR_UNITS_PER_MAJOR;
  const fraction = (minor % MINOR_UNITS_PER_MAJOR).toString().padStart(2, '0');
  return `${major}.${fraction}`;
}

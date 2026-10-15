function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s,]+/g, ' ')
    .trim();
}

/** Initial display only: editing/replacing the draft never reapplies old units. */
export function checkoutRecoveryInitialStreet(address: unknown): string {
  if (typeof address === 'string') return address.trim();
  if (!address || typeof address !== 'object' || Array.isArray(address))
    return '';
  const record = address as Record<string, unknown>;
  const street = text(record.address) || text(record.address_line1);
  const unit = text(record.address_line2);
  if (!street) return unit;
  if (!unit) return street;
  const normalizedUnit = normalize(unit);
  // Numeric-only units must occupy a separate address segment: a house
  // number appearing elsewhere in the street is not evidence of the unit.
  const alreadyIncluded = /^\d+$/.test(normalizedUnit)
    ? street.split(/[,\n\r]/).some((part) => normalize(part) === normalizedUnit)
    : ` ${normalize(street)} `.includes(` ${normalizedUnit} `);
  return alreadyIncluded ? street : `${street}, ${unit}`;
}

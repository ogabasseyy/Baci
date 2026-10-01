type AirportType = 'delivery' | 'pickup';

export function getLegacyAirportType(
  address: string | null | undefined
): AirportType | null {
  const normalized = address?.trim().toLowerCase();
  if (normalized === 'airport pickup') return 'pickup';
  if (
    normalized === 'airport delivery' ||
    normalized === 'airport delivery (outside lagos)'
  ) {
    return 'delivery';
  }
  return null;
}

const ABUJA_LOCATION_ALIASES = [
  'abuja',
  'fct',
  'fctabuja',
  'abujafct',
  'federalcapitalterritory',
  'abujafederalcapitalterritory',
  'federalcapitalterritoryabuja',
];

export function normalizeGiglLocation(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/\b(state|province|region)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

  return ABUJA_LOCATION_ALIASES.includes(normalized) ? 'abuja' : normalized;
}

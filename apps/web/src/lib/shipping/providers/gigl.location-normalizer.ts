import { getSubdivisions } from '../merchant-rates/subdivisions';

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

/** Resolve state codes without interpreting city names as subdivision codes. */
export function normalizeGiglState(value: string): string {
  const code = value.trim().toUpperCase();
  const subdivision = getSubdivisions('NG').find(
    (entry) => entry.code === code || entry.code === `NG-${code}`
  );
  return normalizeGiglLocation(subdivision?.name ?? value);
}

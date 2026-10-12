import {
  getSubdivisions,
  resolveSubdivisionCode,
} from '../merchant-rates/subdivisions';

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

/** Resolve canonical state names, aliases and codes separately from city names. */
export function normalizeGiglState(value: string): string {
  const code =
    resolveSubdivisionCode('NG', value) ??
    resolveSubdivisionCode('NG', `NG-${value.trim()}`);
  const subdivision = getSubdivisions('NG').find(
    (entry) => entry.code === code
  );
  return normalizeGiglLocation(subdivision?.name ?? value);
}

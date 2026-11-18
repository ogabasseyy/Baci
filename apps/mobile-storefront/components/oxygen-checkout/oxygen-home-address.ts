import type { OxygenFields } from './oxygen-form-utils';

export const oxygenHomeLabels = [
  ['home_house_number', 'House / flat number'],
  ['home_street', 'Street address'],
  ['home_city', 'City / town'],
  ['home_lga', 'Local government area (LGA)'],
  ['home_state', 'State'],
  ['home_landmark', 'Nearby landmark'],
] as const;

export function missingOxygenHomeFields(fields: OxygenFields) {
  return oxygenHomeLabels
    .filter(([key]) => !fields[key]?.trim())
    .map(([key]) => key);
}

/** Display only; keep separate administrative values unchanged in the payload. */
export function oxygenHomeSummary(fields: OxygenFields): string {
  const street = fields.home_street?.trim() ?? '';
  const house = fields.home_house_number?.trim() ?? '';
  const parts = [
    house && !street.toLowerCase().startsWith(`${house.toLowerCase()} `)
      ? house
      : '',
    street,
    fields.home_lga,
    fields.home_city,
    fields.home_state,
  ];
  const seen = new Set<string>();
  return parts
    .filter((part): part is string => {
      const normalized = part?.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .map((part) => part.trim())
    .join(', ');
}

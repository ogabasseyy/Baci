import { describe, expect, it } from 'vitest';
import {
  geoapifyAutocompleteResponseSchema,
  geoapifyAutocompleteResultSchema,
} from './geoapify-autocomplete-response';

describe('Geoapify response schema', () => {
  const place = { place_id: 'place', formatted: 'Lagos, Nigeria' };
  it('allows empty results at the envelope level', () => {
    expect(geoapifyAutocompleteResponseSchema.parse({ results: [] })).toEqual({
      results: [],
    });
  });
  it('retains bounded coordinates and confidence used for delivery decisions', () => {
    const details = {
      ...place,
      lat: -90,
      lon: 180,
      rank: { confidence_street_level: 0.9, confidence_building_level: 1 },
    };
    expect(geoapifyAutocompleteResultSchema.parse(details)).toEqual(details);
  });
  it('strips unrelated provider fields from the safe projection', () => {
    expect(
      geoapifyAutocompleteResultSchema.parse({
        ...place,
        raw: { secret: 'ignored' },
      })
    ).toEqual(place);
  });
  it.each([
    { ...place, place_id: '' },
    { ...place, formatted: '' },
    { ...place, lat: 91 },
    { ...place, lat: -91 },
    { ...place, lon: 181 },
    { ...place, lon: -181 },
    { ...place, lat: '6.5' },
    { ...place, lat: Number.NaN },
    { ...place, lon: Number.POSITIVE_INFINITY },
    { ...place, rank: { confidence_building_level: 'high' } },
  ])('rejects malformed provider result %j', (result) => {
    expect(geoapifyAutocompleteResultSchema.safeParse(result).success).toBe(
      false
    );
  });
  it.each([
    {},
    { results: null },
    { results: {} },
  ])('rejects malformed result collections %j', (response) => {
    expect(geoapifyAutocompleteResponseSchema.safeParse(response).success).toBe(
      false
    );
  });
});

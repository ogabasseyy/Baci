import { describe, expect, it } from 'vitest';
import {
  geoapifyAutocompleteResponseSchema,
  placesAutocompleteSchema,
} from './places-autocomplete';

describe('autocomplete request schema', () => {
  it('trims searches and normalizes the optional country filter', () => {
    expect(
      placesAutocompleteSchema.parse({
        input: ' Lagos ',
        country: 'NG',
        fallback: 'geoapify',
        sessionToken: 'session',
      })
    ).toEqual({
      input: 'Lagos',
      country: 'ng',
      fallback: 'geoapify',
      sessionToken: 'session',
    });
  });
  it('supports short input and older clients without fallback or session fields', () => {
    expect(placesAutocompleteSchema.parse({ input: ' ' })).toEqual({
      input: '',
    });
  });
  it('accepts the exact search and token length bounds', () => {
    expect(
      placesAutocompleteSchema.safeParse({
        input: 'x'.repeat(300),
        sessionToken: 's'.repeat(256),
      }).success
    ).toBe(true);
  });
  it.each([
    {},
    { input: 123 },
    { input: 'x'.repeat(301) },
    { input: 'Lagos', country: 'Nigeria' },
    { input: 'Lagos', country: 'N1' },
    { input: 'Lagos', fallback: 'other' },
    { input: 'Lagos', sessionToken: 's'.repeat(257) },
  ])('rejects malformed request %j', (input) => {
    expect(placesAutocompleteSchema.safeParse(input).success).toBe(false);
  });
});

describe('Geoapify response schema', () => {
  const place = { place_id: 'place', formatted: 'Lagos, Nigeria' };
  it('allows empty results and optional address fields', () => {
    expect(geoapifyAutocompleteResponseSchema.parse({ results: [] })).toEqual({
      results: [],
    });
    expect(
      geoapifyAutocompleteResponseSchema.parse({ results: [place] })
    ).toEqual({ results: [place] });
  });
  it('retains bounded coordinates and confidence used for delivery decisions', () => {
    const details = {
      ...place,
      lat: -90,
      lon: 180,
      rank: { confidence_street_level: 0.9, confidence_building_level: 1 },
    };
    expect(
      geoapifyAutocompleteResponseSchema.parse({ results: [details] })
        .results[0]
    ).toEqual(details);
  });
  it('strips unrelated provider fields from the safe projection', () => {
    expect(
      geoapifyAutocompleteResponseSchema.parse({
        results: [{ ...place, raw: { secret: 'ignored' } }],
        apiKey: 'ignored',
      })
    ).toEqual({ results: [place] });
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
    expect(
      geoapifyAutocompleteResponseSchema.safeParse({ results: [result] })
        .success
    ).toBe(false);
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

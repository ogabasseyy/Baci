import { describe, expect, it } from 'vitest';
import { placesAutocompleteSchema } from './places-autocomplete';

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

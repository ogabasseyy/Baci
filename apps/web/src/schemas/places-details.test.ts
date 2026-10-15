import { describe, expect, it } from 'vitest';
import { placesDetailsSchema } from './places-details';

describe('details request schema', () => {
  it('accepts a place ID with an optional session token', () => {
    expect(
      placesDetailsSchema.parse({
        placeId: 'ChIJ1234',
        sessionToken: 'session',
      })
    ).toEqual({ placeId: 'ChIJ1234', sessionToken: 'session' });
  });
  it('accepts the exact place ID and token length bounds', () => {
    expect(
      placesDetailsSchema.safeParse({
        placeId: `places/${'x'.repeat(4000)}`,
        sessionToken: 's'.repeat(256),
      }).success
    ).toBe(true);
  });
  it.each([
    {},
    { placeId: 'x'.repeat(4008) },
    { placeId: 'ChIJ1234', sessionToken: 's'.repeat(257) },
  ])('rejects malformed request %j', (input) => {
    expect(placesDetailsSchema.safeParse(input).success).toBe(false);
  });
  it('reports a missing place ID as required', () => {
    const parsed = placesDetailsSchema.safeParse({});
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe('placeId is required');
  });
});

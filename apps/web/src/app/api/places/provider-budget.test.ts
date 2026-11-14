import { describe, expect, it } from 'vitest';
import {
  reserveGeoapifyRequest,
  reserveGooglePlacesRequest,
} from './provider-budget';

describe('address provider budget reservations', () => {
  it('allows Google autocomplete and details requests without requiring Redis', async () => {
    expect(await reserveGooglePlacesRequest('autocomplete')).toEqual({
      reserved: true,
    });
    expect(await reserveGooglePlacesRequest('details')).toEqual({
      reserved: true,
    });
  });

  it('allows Geoapify fallback requests without requiring Redis', async () => {
    expect(await reserveGeoapifyRequest()).toBe(true);
  });
});

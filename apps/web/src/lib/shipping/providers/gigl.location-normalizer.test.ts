import { describe, expect, it } from 'vitest';
import { normalizeGiglLocation } from './gigl.location-normalizer';

describe('normalizeGiglLocation', () => {
  it.each([
    'Abuja',
    'FCT',
    'FCT - Abuja',
    'Abuja, FCT',
    'Federal Capital Territory',
    'Federal Capital Territory, Abuja',
  ])('normalizes %s to the Abuja station alias', (value) => {
    expect(normalizeGiglLocation(value)).toBe('abuja');
  });

  it('keeps ordinary locations canonicalized', () => {
    expect(normalizeGiglLocation('Lagos State')).toBe('lagos');
  });
});

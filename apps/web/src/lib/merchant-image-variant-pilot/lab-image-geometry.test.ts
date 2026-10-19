import { describe, expect, it } from 'vitest';
import { labImageGeometry } from './lab-image-geometry';

describe('labImageGeometry', () => {
  it('returns the recorded sizes for known slots and null for unknown slots', () => {
    expect(labImageGeometry('header-logo')).toEqual({ sizes: '40px' });
    expect(labImageGeometry('product-card')).toEqual({ sizes: '50vw' });
    expect(labImageGeometry('unknown-slot')).toBeNull();
  });
});

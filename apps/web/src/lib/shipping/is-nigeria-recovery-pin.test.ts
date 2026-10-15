import { describe, expect, it } from 'vitest';
import boundary from './data/nigeria-adm0-boundary.json';
import { isNigeriaRecoveryPin } from './is-nigeria-recovery-pin';

describe('isNigeriaRecoveryPin', () => {
  it('uses the complete versioned national Polygon without simplification', () => {
    expect(boundary.type).toBe('Polygon');
    expect(boundary.coordinates).toHaveLength(1);
    expect(boundary.coordinates[0]).toHaveLength(7205);
  });
  it('accepts a pin exactly on a boundary vertex', () => {
    const [longitude, latitude] = boundary.coordinates[0][0];
    expect(isNigeriaRecoveryPin(latitude, longitude)).toBe(true);
  });
  it.each([
    [Number.NaN, 3],
    [6, Number.POSITIVE_INFINITY],
    [91, 3],
    [6, 181],
    [0, 0],
    [9.3, 13.4],
  ])('rejects invalid or foreign pin %s, %s', (latitude, longitude) => {
    expect(isNigeriaRecoveryPin(latitude, longitude)).toBe(false);
  });
});

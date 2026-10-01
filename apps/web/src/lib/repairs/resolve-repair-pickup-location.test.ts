import { describe, expect, it } from 'vitest';
import { resolveRepairPickupLocation } from './resolve-repair-pickup-location';

describe('resolveRepairPickupLocation', () => {
  it('infers Osun from the alternate Oshogbo spelling', () => {
    const result = resolveRepairPickupLocation(
      '14 Testing Close, Oke Fia, Oshogbo'
    );

    expect(result).toMatchObject({ city: 'Oshogbo', state: 'Osun' });
  });

  it('uses an explicit Nigerian state and preceding city', () => {
    const result = resolveRepairPickupLocation(
      '12 Aba Road, Port Harcourt, Rivers, Nigeria'
    );

    expect(result).toMatchObject({ city: 'Port Harcourt', state: 'Rivers' });
  });

  it('bugfix: uses the state label as city when the preceding segment is street-only', () => {
    const result = resolveRepairPickupLocation(
      '12 Allen Avenue, Lagos, Nigeria'
    );

    expect(result).toMatchObject({ city: 'Lagos', state: 'Lagos' });
  });

  it('preserves the shared fallback for an unknown locality', () => {
    const result = resolveRepairPickupLocation('12 Unknown Road, New Town');

    expect(result).toMatchObject({ city: 'New Town', state: 'New Town' });
  });
});

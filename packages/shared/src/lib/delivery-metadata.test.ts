import { describe, expect, it } from 'vitest';
import { formatDeliveryMetadataLabel } from './delivery-metadata';

describe('formatDeliveryMetadataLabel', () => {
  it('formats underscored metadata for order views', () => {
    expect(formatDeliveryMetadataLabel('pickup_station')).toBe(
      'Pickup Station'
    );
  });

  it('returns null for missing metadata', () => {
    expect(formatDeliveryMetadataLabel(null)).toBeNull();
    expect(formatDeliveryMetadataLabel(undefined)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import {
  REPAIR_PICKUP_COUNTRY_SEGMENTS,
  REPAIR_PICKUP_LOCATION_ALIASES,
  REPAIR_PICKUP_STATE_DISPLAY_LABELS,
} from './repair-pickup-location-constants';

describe('repair pickup location constants', () => {
  it('recognizes the supported Nigeria address segments', () => {
    expect([...REPAIR_PICKUP_COUNTRY_SEGMENTS]).toEqual(['nigeria', 'ng']);
  });

  it('normalizes the alternate Osogbo spelling', () => {
    expect(REPAIR_PICKUP_LOCATION_ALIASES).toEqual({ oshogbo: 'osogbo' });
  });

  it('maps the GIGL FCT label to its customer-facing state name', () => {
    expect(REPAIR_PICKUP_STATE_DISPLAY_LABELS).toEqual({
      'FCT - Abuja': 'Abuja',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { mapKnownGiglStatus } from './gigl-tracking-status';

describe('mapKnownGiglStatus', () => {
  it.each([
    ['MAPT', 'pickup_scheduled'],
    ['MENP', 'pickup_scheduled'],
    ['MPIK', 'picked_up'],
    ['WC', 'out_for_delivery'],
    ['SHD', 'delivered'],
    ['MSCC', 'cancelled'],
    ['ARF', 'in_transit'],
    ['ARFK', 'in_transit'],
    ['ARUS', 'in_transit'],
    ['MRTE', 'in_transit'],
    ['RSR', 'in_transit'],
    ['SRHUB', 'returned'],
    ['DASH', 'in_transit'],
    ['SDR', 'failed'],
    ['DFA', 'out_for_delivery'],
  ] as const)('maps %s to %s', (rawStatus, expected) => {
    expect(mapKnownGiglStatus(rawStatus)).toBe(expected);
  });

  it('does not infer a lifecycle state for an unpublished code', () => {
    expect(mapKnownGiglStatus('UNPUBLISHED_CODE')).toBeNull();
  });

  it('normalizes punctuation and casing before lookup', () => {
    expect(mapKnownGiglStatus('Shipment delivered.')).toBe('delivered');
  });
});

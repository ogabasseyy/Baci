import { describe, expect, it } from 'vitest';
import type { TrackingResult } from '@/lib/shipping/types';
import {
  needsPreshipmentCancellationRead,
  withPreshipmentCancellation,
} from './gigl-tracking-preshipment-cancellation';

const base: TrackingResult = {
  actualDelivery: new Date('2026-11-02T10:00:00.000Z'),
  carrierName: 'GIG Logistics',
  estimatedDelivery: new Date('2026-11-03T10:00:00.000Z'),
  events: [
    {
      description: 'In transit',
      providerEventKey: 'MAPT:1',
      rawStatus: 'MAPT',
      status: 'in_transit',
      timestamp: new Date('2026-11-02T06:00:00.000Z'),
    },
  ],
  provider: 'GIGL',
  status: 'in_transit',
  trackingNumber: 'W1',
};

describe('needsPreshipmentCancellationRead', () => {
  it('reads when the waybill is missing from the feed', () => {
    expect(needsPreshipmentCancellationRead(undefined)).toBe(true);
  });

  it.each([
    'booked',
    'in_transit',
    'failed',
  ] as const)('reads for non-terminal feed status %s', (status) => {
    expect(needsPreshipmentCancellationRead({ ...base, status })).toBe(true);
  });

  it.each([
    'delivered',
    'cancelled',
    'returned',
  ] as const)('skips the read for terminal feed status %s', (status) => {
    expect(needsPreshipmentCancellationRead({ ...base, status })).toBe(false);
  });
});

describe('withPreshipmentCancellation', () => {
  const at = new Date('2026-11-10T00:00:00.000Z');

  it('puts a stable cancelled event first and keeps feed events', () => {
    const out = withPreshipmentCancellation(base, 'W1', at);
    expect(out.status).toBe('cancelled');
    expect(out.events[0]).toMatchObject({
      providerEventKey: 'preshipment-cancelled:W1',
      status: 'cancelled',
      timestamp: at,
    });
    expect(out.events).toHaveLength(2);
  });

  it('keeps the last known location from the feed', () => {
    const withLocation: TrackingResult = {
      ...base,
      events: [{ ...base.events[0]!, location: 'Lagos Hub' }],
    };
    const out = withPreshipmentCancellation(withLocation, 'W1', at);
    expect(out.events[0]?.location).toBe('Lagos Hub');
  });

  it('clears delivery timestamps inherited from the feed result', () => {
    const out = withPreshipmentCancellation(base, 'W1', at);
    expect(out.actualDelivery).toBeUndefined();
    expect(out.estimatedDelivery).toBeUndefined();
  });

  it('builds a result when the feed omitted the waybill', () => {
    const out = withPreshipmentCancellation(undefined, 'W1', at);
    expect(out).toMatchObject({ provider: 'GIGL', trackingNumber: 'W1' });
    expect(out.events).toHaveLength(1);
  });
});

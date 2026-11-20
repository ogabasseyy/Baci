import { describe, expect, it } from 'vitest';
import type { TrackingEvent } from '../types';
import { resolveAggregate } from './gigl.tracking-aggregate';
import type { Guardable } from './gigl.tracking-status-rank';

function scan(
  providerStatus: string,
  recognizedStatus: TrackingEvent['status'] | null,
  hour: number
): Guardable {
  return {
    providerStatus,
    recognizedStatus,
    event: {
      status: recognizedStatus ?? 'in_transit',
      rawStatus: providerStatus,
      description: providerStatus,
      timestamp: new Date(Date.UTC(2026, 10, 9, hour)),
    } as TrackingEvent,
  };
}

// resolveAggregate takes the scans newest first.
const newestFirst = (...scans: Guardable[]) =>
  [...scans].sort(
    (a, b) => b.event.timestamp.getTime() - a.event.timestamp.getTime()
  );

describe('resolveAggregate', () => {
  it('defaults to the newest recognized status with no lead', () => {
    const result = resolveAggregate(
      newestFirst(scan('DPC', 'in_transit', 10), scan('MSVC', 'in_transit', 11))
    );
    expect(result.status).toBe('in_transit');
    expect(result.lead).toBeUndefined();
  });

  it('is pending when nothing is recognized', () => {
    expect(resolveAggregate(newestFirst(scan('XYZ', null, 10))).status).toBe(
      'pending'
    );
  });

  it('keeps a terminal outcome over a newer progress scan and leads with it', () => {
    const shd = scan('SHD', 'delivered', 10);
    const result = resolveAggregate(
      newestFirst(shd, scan('MSVC', 'in_transit', 12))
    );
    expect(result.status).toBe('delivered');
    expect(result.lead).toBe(shd);
  });

  it('does not reorder when the terminal scan is already the newest recognized', () => {
    const result = resolveAggregate(
      newestFirst(scan('MSVC', 'in_transit', 9), scan('SHD', 'delivered', 10))
    );
    expect(result.status).toBe('delivered');
    expect(result.lead).toBeUndefined();
  });

  it('ranks cancelled above delivered whatever the order in time', () => {
    const cancel = scan('MSCP', 'cancelled', 10);
    const result = resolveAggregate(
      newestFirst(cancel, scan('SHD', 'delivered', 11))
    );
    expect(result.status).toBe('cancelled');
    expect(result.lead).toBe(cancel);
  });

  it('keeps a destroyed shipment failed and leads with the SDR', () => {
    const sdr = scan('SDR', 'failed', 10);
    const result = resolveAggregate(
      newestFirst(sdr, scan('MSVC', 'in_transit', 12))
    );
    expect(result.status).toBe('failed');
    expect(result.lead).toBe(sdr);
  });

  it('lets a newer SDR override an older terminal scan', () => {
    const sdr = scan('SDR', 'failed', 11);
    const result = resolveAggregate(
      newestFirst(
        scan('SHD', 'delivered', 10),
        sdr,
        scan('MSVC', 'in_transit', 12)
      )
    );
    expect(result.status).toBe('failed');
    expect(result.lead).toBe(sdr);
  });

  it('lets a terminal scan newer than the SDR win', () => {
    const shd = scan('SHD', 'delivered', 11);
    const result = resolveAggregate(
      newestFirst(
        scan('SDR', 'failed', 10),
        shd,
        scan('MSVC', 'in_transit', 12)
      )
    );
    expect(result.status).toBe('delivered');
    expect(result.lead).toBe(shd);
  });

  it('ignores a terminal scan older than the SDR even when it outranks a newer terminal', () => {
    const result = resolveAggregate(
      newestFirst(
        scan('MSCP', 'cancelled', 9),
        scan('SDR', 'failed', 10),
        scan('SHD', 'delivered', 11)
      )
    );
    expect(result.status).toBe('delivered');
    // Already the newest scan, so no reorder is needed.
    expect(result.lead).toBeUndefined();
  });

  it('lets a terminal scan tied with the SDR win', () => {
    const shd = scan('SHD', 'delivered', 10);
    const result = resolveAggregate(
      newestFirst(scan('SDR', 'failed', 10), shd)
    );
    expect(result.status).toBe('delivered');
    expect(result.lead).toBeDefined();
  });

  it('does not depend on the caller sorting the scans newest first', () => {
    const shd = scan('SHD', 'delivered', 11);
    const result = resolveAggregate([
      scan('MSVC', 'in_transit', 9),
      shd,
      scan('SDR', 'failed', 10),
    ]);
    expect(result.status).toBe('delivered');
    expect(result.lead).toBeUndefined();
  });

  it.each([
    ['cancelled listed first', ['MSCP', 'SRHUB']],
    ['returned listed first', ['SRHUB', 'MSCP']],
  ])('breaks a cancelled/returned tie deterministically whatever the payload order (%s)', (_label, order) => {
    const scans = {
      MSCP: scan('MSCP', 'cancelled', 10),
      SRHUB: scan('SRHUB', 'returned', 10),
    };
    const result = resolveAggregate(
      order.map((key) => scans[key as 'MSCP' | 'SRHUB'])
    );
    expect(result.status).toBe('cancelled');
  });

  it('keeps the newest of cancelled and returned when their timestamps differ', () => {
    const returned = scan('SRHUB', 'returned', 11);
    const result = resolveAggregate(
      newestFirst(scan('MSCP', 'cancelled', 9), returned)
    );
    expect(result.status).toBe('returned');
    expect(result.lead).toBeUndefined();
  });

  it('lets a newer failed scan supersede an older terminal scan', () => {
    const failed = scan('DELIVERY_FAILED', 'failed', 11);
    const result = resolveAggregate(
      newestFirst(scan('SHD', 'delivered', 10), failed)
    );
    expect(result.status).toBe('failed');
    expect(result.lead).toBeUndefined();
  });

  it('keeps a terminal scan that follows a failed attempt', () => {
    const result = resolveAggregate(
      newestFirst(
        scan('DELIVERY_FAILED', 'failed', 9),
        scan('SHD', 'delivered', 10)
      )
    );
    expect(result.status).toBe('delivered');
  });
});

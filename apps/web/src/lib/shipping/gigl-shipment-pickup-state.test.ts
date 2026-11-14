import { describe, expect, it, vi } from 'vitest';
import {
  hasUnpickedGiglShipment,
  shouldDeferShippedNotificationToGigPickup,
} from './gigl-shipment-pickup-state';

function client(rows: { status: string }[] | null, error: unknown = null) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    neq: vi.fn().mockResolvedValue({ data: rows, error }),
  };
  return { from: vi.fn(() => builder), builder };
}

describe('hasUnpickedGiglShipment', () => {
  it.each([
    'pending',
    'booked',
    'pickup_scheduled',
  ])('is true while the live GIG shipment is %s (no early shipped alert)', async (status) => {
    const c = client([{ status }]);
    await expect(hasUnpickedGiglShipment(c as never, 'o1')).resolves.toBe(true);
    expect(c.builder.eq).toHaveBeenCalledWith('provider', 'GIGL');
  });

  it.each([
    'picked_up',
    'in_transit',
    'delivered',
  ])('is false once the GIG shipment is %s', async (status) => {
    const c = client([{ status }]);
    await expect(hasUnpickedGiglShipment(c as never, 'o1')).resolves.toBe(
      false
    );
  });

  it('bugfix: an abandoned older booking does not hold the notification once a newer shipment is picked up', async () => {
    const c = client([
      { status: 'booked', created_at: '2026-11-01T10:00:00Z' },
      { status: 'picked_up', created_at: '2026-11-02T10:00:00Z' },
    ] as never);
    await expect(hasUnpickedGiglShipment(c as never, 'o1')).resolves.toBe(
      false
    );
  });

  it('bugfix: fails closed for a known GIG order when the shipment read is empty or errors', async () => {
    await expect(
      hasUnpickedGiglShipment(client([]) as never, 'o1', true)
    ).resolves.toBe(true);
    await expect(
      hasUnpickedGiglShipment(
        client(null, { message: 'x' }) as never,
        'o1',
        true
      )
    ).resolves.toBe(true);
  });

  it('is false for non-GIG and self-fulfilled orders with no GIG shipment', async () => {
    await expect(
      hasUnpickedGiglShipment(client([]) as never, 'o1')
    ).resolves.toBe(false);
  });

  it('fails open (false) when the lookup errors so shipped alerts are never lost', async () => {
    await expect(
      hasUnpickedGiglShipment(client(null, { message: 'x' }) as never, 'o1')
    ).resolves.toBe(false);
  });
});

describe('shouldDeferShippedNotificationToGigPickup', () => {
  it('defers shipped for a booked GIG order', async () => {
    await expect(
      shouldDeferShippedNotificationToGigPickup(
        client([{ status: 'booked' }]) as never,
        'o1',
        'shipped'
      )
    ).resolves.toBe(true);
  });
  it('never defers other statuses and skips the lookup', async () => {
    const c = client([{ status: 'booked' }]);
    await expect(
      shouldDeferShippedNotificationToGigPickup(c as never, 'o1', 'delivered')
    ).resolves.toBe(false);
    expect(c.from).not.toHaveBeenCalled();
  });
  it('does not defer a non-GIG order', async () => {
    await expect(
      shouldDeferShippedNotificationToGigPickup(
        client([]) as never,
        'o1',
        'shipped'
      )
    ).resolves.toBe(false);
  });
});

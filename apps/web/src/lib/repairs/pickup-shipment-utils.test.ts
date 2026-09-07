import { describe, expect, it } from 'vitest';
import {
  buildPickupItems,
  buildPickupSender,
  type PickupFailureReason,
  pickupFailure,
  type RepairPickupSource,
} from './pickup-shipment-utils';

const baseRepair: RepairPickupSource = {
  customer_name: 'Ada Lovelace',
  customer_email: 'ada@example.com',
  customer_phone: '08012345678',
  device_type: 'Smartphone',
  device_model: 'iPhone 15',
  pickup_address: '12 Aba Road, Port Harcourt, Rivers',
  quoted_price: 45_000,
};

describe('buildPickupSender', () => {
  it('derives city/state from the pickup address', () => {
    const sender = buildPickupSender(baseRepair);
    expect(sender).toMatchObject({
      name: 'Ada Lovelace',
      phone: '08012345678',
      email: 'ada@example.com',
      state: 'Rivers',
      country: 'Nigeria',
      countryCode: 'NG',
    });
  });

  it('infers Osun when a Google address ends in Osogbo without a state', () => {
    const sender = buildPickupSender({
      ...baseRepair,
      pickup_address: '14 Testing Close, Oke Fia, Osogbo',
    });

    expect(sender).toMatchObject({
      city: 'Osogbo',
      state: 'Osun',
    });
  });

  it('returns null when there is no pickup address', () => {
    expect(
      buildPickupSender({ ...baseRepair, pickup_address: null })
    ).toBeNull();
    expect(
      buildPickupSender({ ...baseRepair, pickup_address: '   ' })
    ).toBeNull();
  });

  it('falls back to a placeholder name when missing', () => {
    const sender = buildPickupSender({ ...baseRepair, customer_name: null });
    expect(sender?.name).toBe('Customer');
  });

  it('uses an empty phone and undefined email when both are null', () => {
    const sender = buildPickupSender({
      ...baseRepair,
      customer_phone: null,
      customer_email: null,
    });
    expect(sender?.phone).toBe('');
    expect(sender?.email).toBeUndefined();
  });
});

describe('buildPickupItems', () => {
  it('labels the item with device type + model and uses the fixed declared value', () => {
    const [item] = buildPickupItems(baseRepair);
    expect(item.name).toBe('Smartphone iPhone 15');
    expect(item.value).toBe(50_000);
    expect(item.quantity).toBe(1);
  });

  it('keeps the fixed declared value even when a catalog quoted price differs', () => {
    const [item] = buildPickupItems({ ...baseRepair, quoted_price: 120_000 });
    expect(item.value).toBe(50_000);
  });

  it('falls back to a generic name when device fields are empty', () => {
    const [item] = buildPickupItems({
      ...baseRepair,
      device_type: null,
      device_model: null,
    });
    expect(item.name).toBe('Device for repair');
  });
});

describe('pickupFailure', () => {
  const cases: readonly [PickupFailureReason, boolean][] = [
    ['not_found', false],
    ['lookup_failed', false],
    ['already_booked', false],
    ['missing_pickup_address', true],
    ['repair_center_unconfigured', true],
    ['gigl_unavailable', true],
    ['booking_failed', true],
    ['provider_rejected', true],
    ['shipment_save_failed', false],
  ];

  it.each(
    cases
  )('reason %s exposes canRetryManually=%s with a non-empty message', (reason, canRetryManually) => {
    const result = pickupFailure(reason);
    expect(result).toMatchObject({ ok: false, reason, canRetryManually });
    expect(result.message.length).toBeGreaterThan(0);
  });
});

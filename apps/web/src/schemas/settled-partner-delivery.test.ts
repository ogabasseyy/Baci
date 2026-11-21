import { describe, expect, it } from 'vitest';
import { settledDeliverySchema } from './settled-partner-delivery';

const delivery = { service: 'Standard', delivery_minor: 150_000 };

describe('settledDeliverySchema', () => {
  it('accepts a carrier service and positive whole kobo', () => {
    expect(settledDeliverySchema.parse(delivery)).toEqual(delivery);
  });

  it('rejects an empty service', () => {
    expect(
      settledDeliverySchema.safeParse({ ...delivery, service: '' }).success
    ).toBe(false);
  });

  it.each([
    0, -1, 10.5,
  ])('rejects an invalid delivery amount of %s kobo', (delivery_minor) => {
    expect(
      settledDeliverySchema.safeParse({ ...delivery, delivery_minor }).success
    ).toBe(false);
  });
});

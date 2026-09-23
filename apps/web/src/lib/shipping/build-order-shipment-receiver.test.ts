import { describe, expect, it } from 'vitest';
import { buildOrderShipmentReceiver } from './build-order-shipment-receiver';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';

describe('buildOrderShipmentReceiver', () => {
  it('builds a complete receiver and preserves finite coordinates', () => {
    expect(
      buildOrderShipmentReceiver({
        customer_name: 'Jane Customer',
        customer_email: 'jane@example.com',
        customer_phone: '08012345678',
        shipping_address: {
          address: '123 Queen Street West',
          city: 'Toronto',
          state: 'Ontario',
          country: 'Canada',
          countryCode: 'CA',
          latitude: 43.6532,
          longitude: -79.3832,
        },
      })
    ).toMatchObject({
      city: 'Toronto',
      state: 'Ontario',
      latitude: 43.6532,
      longitude: -79.3832,
    });
  });

  it('allows coordinate-only receivers only when explicitly enabled', () => {
    const order = {
      customer_name: 'Jane Customer',
      customer_email: null,
      customer_phone: '08012345678',
      shipping_address: {
        address: 'Google formatted destination',
        city: '',
        state: '',
        latitude: 6.6018,
        longitude: 3.3515,
      },
    };

    expect(() => buildOrderShipmentReceiver(order)).toThrow(
      OrderShipmentBookingError
    );
    expect(
      buildOrderShipmentReceiver(order, {
        allowCoordinatesWithoutCityState: true,
      })
    ).toMatchObject({
      city: '',
      state: '',
      latitude: 6.6018,
      longitude: 3.3515,
    });
  });

  it('does not allow out-of-range coordinates to bypass city and state', () => {
    expect(() =>
      buildOrderShipmentReceiver(
        {
          customer_name: 'Jane Customer',
          customer_email: null,
          customer_phone: '08012345678',
          shipping_address: {
            address: 'Invalid coordinate destination',
            city: '',
            state: '',
            latitude: 91,
            longitude: 181,
          },
        },
        { allowCoordinatesWithoutCityState: true }
      )
    ).toThrow(OrderShipmentBookingError);
  });

  it('normalizes bounded numeric-string coordinates for coordinate-only receivers', () => {
    expect(
      buildOrderShipmentReceiver(
        {
          customer_name: 'Jane Customer',
          customer_email: null,
          customer_phone: '08012345678',
          shipping_address: {
            address: 'Persisted Google destination',
            city: '',
            state: '',
            latitude: '6.6018',
            longitude: '3.3515',
          },
        },
        { allowCoordinatesWithoutCityState: true }
      )
    ).toMatchObject({ latitude: 6.6018, longitude: 3.3515 });
  });

  it('rejects invalid persisted coordinate strings', () => {
    for (const [latitude, longitude] of [
      ['', '3.3515'],
      ['not-a-number', '3.3515'],
      ['6.6018', '181'],
    ]) {
      expect(() =>
        buildOrderShipmentReceiver(
          {
            customer_name: 'Jane Customer',
            customer_email: null,
            customer_phone: '08012345678',
            shipping_address: {
              address: 'Invalid persisted destination',
              city: '',
              state: '',
              latitude,
              longitude,
            },
          },
          { allowCoordinatesWithoutCityState: true }
        )
      ).toThrow(OrderShipmentBookingError);
    }
  });

  describe('bugfix: booking used customer phone over recipient phone', () => {
    it('prefers the shipping-address phone and falls back to customer phone', () => {
      expect(
        buildOrderShipmentReceiver({
          customer_name: 'Jane Customer',
          customer_email: null,
          customer_phone: '08010000000',
          shipping_address: {
            address: '1 Allen Avenue',
            city: 'Lagos',
            state: 'Lagos',
            phone: '08020000000',
          },
        }).phone
      ).toBe('08020000000');

      expect(
        buildOrderShipmentReceiver({
          customer_name: 'Jane Customer',
          customer_email: null,
          customer_phone: '08010000000',
          shipping_address: {
            address: '1 Allen Avenue',
            city: 'Lagos',
            state: 'Lagos',
          },
        }).phone
      ).toBe('08010000000');
    });
  });
});

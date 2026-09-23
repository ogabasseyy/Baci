import { describe, expect, it } from 'vitest';
import { resolveAdminGiglBookingContext } from './admin-gigl-booking-context';

const adminDomesticQuote = {
  shipmentType: 'domestic' as const,
  sessionId: 'order-1',
  admin_order_provenance: 'server_gigl_v1' as const,
  receiver: {
    name: 'Customer',
    phone: '08000000000',
    address: 'Receiver Road',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    countryCode: 'NG',
    latitude: 6.6018,
    longitude: 3.3515,
  },
  items: [],
};

describe('Admin GIGL booking context', () => {
  it('uses Admin context only for the server-attested domestic GIGL path', () => {
    const order = {
      customer_name: 'Customer',
      customer_email: null,
      customer_phone: '08000000000',
      shipping_address: adminDomesticQuote.receiver,
    };
    expect(
      resolveAdminGiglBookingContext('GIGL', order, adminDomesticQuote)
        .defaultWeight
    ).toBe(1);
    expect(
      resolveAdminGiglBookingContext('TOPSHIP', order, adminDomesticQuote)
        .defaultWeight
    ).toBe(1);
    expect(
      resolveAdminGiglBookingContext('GIGL', order, {
        ...adminDomesticQuote,
        admin_order_provenance: undefined,
      }).defaultWeight
    ).toBe(1);
  });

  it('merges attested coordinates and prefers quoted delivery contact', () => {
    const result = resolveAdminGiglBookingContext(
      'GIGL',
      {
        customer_name: 'Order Customer',
        customer_email: null,
        customer_phone: '08000000000',
        shipping_address: adminDomesticQuote.receiver,
      },
      {
        ...adminDomesticQuote,
        receiver: {
          ...adminDomesticQuote.receiver,
          name: 'Quoted Receiver',
          phone: '08011112222',
        },
      }
    ).receiver;
    expect(result).toMatchObject({
      name: 'Quoted Receiver',
      phone: '08011112222',
      latitude: 6.6018,
      longitude: 3.3515,
    });
  });

  it('falls back to order receiver contact when quote contact is blank', () => {
    const result = resolveAdminGiglBookingContext(
      'GIGL',
      {
        customer_name: 'Order Customer',
        customer_email: null,
        customer_phone: '08000000000',
        shipping_address: adminDomesticQuote.receiver,
      },
      {
        ...adminDomesticQuote,
        receiver: {
          ...adminDomesticQuote.receiver,
          name: '   ',
          phone: '',
        },
      }
    ).receiver;
    expect(result).toMatchObject({
      name: 'Order Customer',
      phone: '08000000000',
      latitude: 6.6018,
      longitude: 3.3515,
    });
  });
});

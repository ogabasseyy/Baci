import { describe, expect, it } from 'vitest';
import { giglSchemas } from './gigl.schemas';

describe('giglSchemas', () => {
  it.each([
    '200',
    '401',
    '503',
  ])('normalizes documented string status %s', (status) => {
    expect(giglSchemas.envelopeObject.parse({ status, data: {} }).status).toBe(
      Number(status)
    );
  });
  it('preserves documented tracking identifiers and UTC timestamps', () => {
    const event = giglSchemas.trackingEvent.parse({
      MobileShipmentTrackingId: 3738770,
      ShipmentTrackingId: 91234,
      Status: 'MAPT',
      DateTimeUtc: '2026-03-02T10:59:41.000Z',
    });

    expect(event.MobileShipmentTrackingId).toBe(3738770);
    expect(event.ShipmentTrackingId).toBe(91234);
    expect(event.DateTimeUtc).toBe('2026-03-02T10:59:41.000Z');
  });

  it('rejects tracking histories over the per-shipment event bound', () => {
    const result = giglSchemas.trackingData.safeParse([
      {
        Waybill: 'GIGL123',
        MobileShipmentTrackings: Array.from({ length: 501 }, (_, index) => ({
          Status: 'MAPT',
          DateTimeUtc: `2026-03-02T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
        })),
      },
    ]);

    expect(result.success).toBe(false);
  });

  it('accepts partial tracking shipments with nullable status reasons', () => {
    const data = giglSchemas.trackingData.parse([
      {
        Waybill: 'GIGL123',
        PickupOptions: 1,
        MobileShipmentTrackings: [
          {
            Status: 'Shipment delivered',
            ScanStatusReason: null,
            DateTime: '2026-06-27T08:00:00.000Z',
          },
        ],
      },
    ]);

    expect(data[0].Origin).toBeUndefined();
    expect(data[0].Destination).toBeUndefined();
    expect(data[0].DeliveryType).toBeUndefined();
    expect(data[0].MobileShipmentTrackings[0].ScanStatusReason).toBe('');
  });

  it('rejects malformed price totals', () => {
    const result = giglSchemas.priceData.safeParse({
      GrandTotal: '8941.43',
    });

    expect(result.success).toBe(false);
  });

  it('validates GIGL country payloads', () => {
    expect(
      giglSchemas.countryData.safeParse([
        {
          CountryId: 36,
          CountryName: 'Canada',
          CountryCode: 'CANADA',
          CountryShortCode: 'CA',
          IsInternationalShippingCountry: true,
        },
      ]).success
    ).toBe(true);
    expect(
      giglSchemas.countryData.safeParse([
        {
          CountryName: 'Canada',
        },
      ]).success
    ).toBe(false);
  });

  it('validates international price rates', () => {
    expect(
      giglSchemas.internationalPriceData.safeParse([
        {
          GrandTotal: 114_534.49,
          LogisticCompany: 0,
          ShipmentMethod: 0,
          DeliveryType: 2,
        },
      ]).success
    ).toBe(true);
    expect(
      giglSchemas.internationalPriceData.safeParse([
        {
          GrandTotal: 0,
          LogisticCompany: 0,
          ShipmentMethod: 0,
          DeliveryType: 2,
        },
      ]).success
    ).toBe(false);
  });

  it('rejects empty international booking payloads', () => {
    const result = giglSchemas.internationalBookingData.safeParse({});

    expect(result.success).toBe(false);
  });

  it('rejects blank international booking identifiers', () => {
    const result = giglSchemas.internationalBookingData.safeParse({
      Waybill: '   ',
    });

    expect(result.success).toBe(false);
  });

  it('requires an invoice label when an invoice payload is parsed', () => {
    expect(
      giglSchemas.invoiceData.safeParse({
        WaybillLabel: 'https://example.test/label.pdf',
      }).success
    ).toBe(true);
    expect(giglSchemas.invoiceData.safeParse({}).success).toBe(false);
  });
});

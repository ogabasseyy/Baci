import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ configured: true }));

vi.mock('server-only', () => ({}));
vi.mock('./providers/gigl', () => ({
  giglProvider: { lookupExternalWaybill: vi.fn() },
}));
vi.mock('./providers/gigl.constants', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  isGiglRuntimeConfigured: () => runtime.configured,
}));

import { previewExternalGiglWaybill } from './external-gigl-waybill-preview';
import { giglProvider } from './providers/gigl';
import { giglPreShipment } from './providers/gigl.test-helpers';

const ORDER_ID = '40000000-0000-4000-8000-000000000001';
const MERCHANT_ID = '10000000-0000-4000-8000-000000000001';

function supabaseFor(orderStatus = 'processing') {
  const results: Record<string, Array<{ data: unknown; error: null }>> = {
    orders: [
      {
        data: {
          id: ORDER_ID,
          order_number: 'ORD-1',
          customer_name: 'Audu Emmanuel',
          customer_phone: '08037608805',
          shipping_address: { state: 'Ebonyi' },
          shipping_status: orderStatus,
        },
        error: null,
      },
      { data: null, error: null },
    ],
    merchant_feature_settings: [
      { data: { shipping_providers: [' GIGL '] }, error: null },
    ],
    shipments: [
      { data: null, error: null },
      { data: null, error: null },
    ],
  };
  return {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'not', 'limit']) {
        builder[method] = () => builder;
      }
      builder.maybeSingle = () => Promise.resolve(results[table]?.shift());
      return builder;
    },
  } as unknown as SupabaseClient;
}

const preShipment = giglPreShipment({
  Waybill: '1349639588',
  UserId: 'gig-user',
  CustomerCode: 'IND405919',
  ReceiverName: 'Audu Emmanuel',
  ReceiverPhoneNumber: '+234 803 760 8805',
  ReceiverAddress: 'ABAKALIKI (CENTRAL PARK)',
  ReceiverState: 'EBONYI',
  IsHomeDelivery: false,
});

function preview(supabase = supabaseFor()) {
  return previewExternalGiglWaybill({
    merchantId: MERCHANT_ID,
    orderId: ORDER_ID,
    supabase,
    waybill: '1349639588',
  });
}

describe('previewExternalGiglWaybill', () => {
  beforeEach(() => {
    runtime.configured = true;
    vi.mocked(giglProvider.lookupExternalWaybill).mockReset();
  });

  it('describes a matching parcel with its newest GIG update', async () => {
    vi.mocked(giglProvider.lookupExternalWaybill).mockResolvedValue({
      status: 'found',
      account: { userChannelCode: 'IND405919', userId: 'gig-user' },
      preShipment,
      tracking: {
        provider: 'GIGL',
        trackingNumber: '1349639588',
        status: 'in_transit',
        carrierName: 'GIG Logistics',
        events: [
          {
            status: 'booked',
            description: 'Booked',
            timestamp: new Date('2026-10-31T13:00:00Z'),
          },
          {
            status: 'in_transit',
            description: 'Shipment Arrives Collation Center',
            location: 'LAGOS GATEWAY',
            timestamp: new Date('2026-10-31T19:55:27Z'),
          },
        ],
      },
    });

    const { lookup, preview: result } = await preview();

    expect(lookup.preShipment.Waybill).toBe('1349639588');
    expect(result).toEqual({
      waybill: '1349639588',
      linkable: true,
      match: { name: 'match', phone: 'match', destination: 'match' },
      order: { customerName: 'Audu Emmanuel', orderNumber: 'ORD-1' },
      gig: {
        receiverName: 'Audu Emmanuel',
        receiverPhoneLast4: '8805',
        destinationState: 'EBONYI',
        deliveryType: 'station',
        stationAddress: 'ABAKALIKI (CENTRAL PARK)',
        trackingStatus: 'In Transit',
        lastUpdate: {
          description: 'Shipment Arrives Collation Center',
          location: 'LAGOS GATEWAY',
          at: '2026-10-31T19:55:27.000Z',
        },
      },
    });
  });

  it('refuses cancelled GIG waybills', async () => {
    vi.mocked(giglProvider.lookupExternalWaybill).mockResolvedValue({
      status: 'found',
      account: { userChannelCode: 'IND405919', userId: 'gig-user' },
      preShipment: { ...preShipment, IsCancelled: true },
      tracking: null,
    });
    await expect(preview()).rejects.toMatchObject({
      code: 'WAYBILL_CANCELLED',
      status: 409,
    });
  });

  it('reports GIG as unavailable when it is not configured', async () => {
    runtime.configured = false;
    await expect(preview()).rejects.toMatchObject({
      code: 'GIGL_UNAVAILABLE',
      status: 503,
    });
    expect(giglProvider.lookupExternalWaybill).not.toHaveBeenCalled();
  });

  it('accepts already-shipped orders, such as self-fulfilled ones', async () => {
    vi.mocked(giglProvider.lookupExternalWaybill).mockResolvedValue({
      status: 'found',
      account: { userChannelCode: 'IND405919', userId: 'gig-user' },
      preShipment,
      tracking: null,
    });
    const { preview: result } = await preview(supabaseFor('shipped'));
    expect(result.linkable).toBe(true);
    expect(result.gig?.trackingStatus).toBeNull();
  });
});

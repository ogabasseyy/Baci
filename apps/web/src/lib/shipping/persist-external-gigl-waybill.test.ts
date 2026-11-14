import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({ getSupabaseServiceRoleKey: () => 's'.repeat(32) }));
vi.mock('./providers/gigl', () => ({ giglProvider: {} }));

import type { FoundExternalWaybill } from './external-gigl-waybill-preview';
import {
  buildExternalWaybillLinkPayload,
  persistExternalGiglWaybill,
} from './persist-external-gigl-waybill';
import { giglPreShipment } from './providers/gigl.test-helpers';

const ORDER_ID = '40000000-0000-4000-8000-000000000001';
const MERCHANT_ID = '10000000-0000-4000-8000-000000000001';

const lookup: FoundExternalWaybill = {
  status: 'found',
  account: { userChannelCode: 'IND405919', userId: 'gig-user' },
  preShipment: giglPreShipment({
    Waybill: '1349639588',
    CustomerCode: 'IND405919',
    SenderName: ' Shop ',
    SenderPhoneNumber: '+2349000000000',
    SenderAddress: 'Ikeja',
    ReceiverName: 'Audu Emmanuel',
    ReceiverPhoneNumber: '+2348037608805',
    ReceiverAddress: 'ABAKALIKI (CENTRAL PARK)',
    ReceiverState: 'EBONYI',
    ReceiverCountry: 'NIGERIA',
    ReceiverStationId: 37,
    DestinationServiceCenterId: 291,
    IsHomeDelivery: false,
    GrandTotal: 45852.2,
    DateCreated: '2026-10-31T13:07:21.945Z',
  }),
  tracking: null,
};

const orderSnapshot = {
  customer_name: 'Audu Emmanuel',
  customer_phone: '08037608805',
  phone: null,
  state: 'Ebonyi',
};

function supabaseWith(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, supabase: { rpc } as unknown as SupabaseClient };
}

describe('buildExternalWaybillLinkPayload', () => {
  it('signs only verified GIG facts in the shape the RPC accepts', () => {
    expect(
      buildExternalWaybillLinkPayload('1349639588', lookup, orderSnapshot)
    ).toEqual({
      waybill: '1349639588',
      account_verified: true,
      receiver_match: true,
      order_receiver: orderSnapshot,
      receiver_address: {
        name: 'Audu Emmanuel',
        phone: '+2348037608805',
        address: 'ABAKALIKI (CENTRAL PARK)',
        state: 'EBONYI',
        country: 'NIGERIA',
      },
      sender_address: {
        name: 'Shop',
        phone: '+2349000000000',
        address: 'Ikeja',
      },
      is_station_pickup: true,
      station_address: 'ABAKALIKI (CENTRAL PARK)',
      price: 45852.2,
      provider_snapshot: {
        source: 'gigl_external_waybill',
        customer_code: 'IND405919',
        receiver_station_id: 37,
        destination_service_centre_id: 291,
        gig_created_at: '2026-10-31T13:07:21.945Z',
        tracking_status_at_link: null,
      },
    });
  });

  it('treats home delivery and a missing price explicitly', () => {
    const payload = buildExternalWaybillLinkPayload(
      '1',
      {
        ...lookup,
        preShipment: {
          ...lookup.preShipment,
          IsHomeDelivery: true,
          GrandTotal: undefined,
        },
      },
      orderSnapshot
    );
    expect(payload).toMatchObject({
      is_station_pickup: false,
      station_address: null,
      price: null,
    });
  });
});

describe('persistExternalGiglWaybill', () => {
  it('calls the RPC with a proof bound to the order and merchant', async () => {
    const { rpc, supabase } = supabaseWith({ data: 'shipment-1', error: null });

    await expect(
      persistExternalGiglWaybill({
        lookup,
        merchantId: MERCHANT_ID,
        orderId: ORDER_ID,
        orderSnapshot,
        supabase,
        waybill: '1349639588',
      })
    ).resolves.toEqual({ shipmentId: 'shipment-1' });

    const [name, args] = rpc.mock.calls[0] ?? [];
    expect(name).toBe('link_external_gigl_waybill');
    expect(args.p_order_id).toBe(ORDER_ID);
    expect(args.p_route_proof).toMatchObject({
      action: 'link_external_gigl_waybill',
      merchant_id: MERCHANT_ID,
      subject_id: ORDER_ID,
      version: 'baci-shipping-quote-proof:v1',
    });
    expect(args.p_route_proof.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['waybill_already_linked', 409, 'WAYBILL_ALREADY_LINKED'],
    ['order_shipment_exists', 409, 'ORDER_SHIPMENT_EXISTS'],
    ['active_merchant_shipping_charge', 409, 'ACTIVE_MERCHANT_SHIPPING_CHARGE'],
    ['order_not_owned', 404, 'ORDER_NOT_FOUND'],
    ['order_changed_during_link', 409, 'ORDER_CHANGED'],
    ['checkout_shipping_retained', 409, 'CHECKOUT_SHIPPING_RETAINED'],
    ['external_waybill_proof_invalid', 500, 'WAYBILL_LINK_FAILED'],
  ])('maps %s to a safe %i response', async (message, status, code) => {
    const { supabase } = supabaseWith({ data: null, error: { message } });
    await expect(
      persistExternalGiglWaybill({
        lookup,
        merchantId: MERCHANT_ID,
        orderId: ORDER_ID,
        orderSnapshot,
        supabase,
        waybill: '1349639588',
      })
    ).rejects.toMatchObject({ code, status });
  });

  it('fails when the RPC returns no shipment id', async () => {
    const { supabase } = supabaseWith({ data: null, error: null });
    await expect(
      persistExternalGiglWaybill({
        lookup,
        merchantId: MERCHANT_ID,
        orderId: ORDER_ID,
        orderSnapshot,
        supabase,
        waybill: '1349639588',
      })
    ).rejects.toMatchObject({ code: 'WAYBILL_LINK_FAILED' });
  });
});

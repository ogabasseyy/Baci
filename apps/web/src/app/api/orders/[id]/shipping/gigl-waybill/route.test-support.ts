import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { vi } from 'vitest';
import { authenticateApiRequest } from '@/lib/api-auth';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { giglProvider } from '@/lib/shipping/providers/gigl';
import { giglPreShipment } from '@/lib/shipping/providers/gigl.test-helpers';

// Shared by route.test.ts and route.link.test.ts. Both files mock the auth,
// merchant and GIG provider modules before importing this helper.
export const ORDER_ID = '40000000-0000-4000-8000-000000000001';
export const MERCHANT_ID = '10000000-0000-4000-8000-000000000001';
export const SHIPMENT_ID = '50000000-0000-4000-8000-000000000001';
export const WAYBILL = '1349639588';
export const ACCOUNT = { userChannelCode: 'IND405919', userId: 'gig-user-1' };

export const order = {
  id: ORDER_ID,
  order_number: 'ORD-291026-TEST',
  customer_name: 'Audu Emmanuel',
  customer_phone: '08037608805',
  shipping_address: { city: 'Abakaliki', state: 'Ebonyi' },
  shipping_status: 'processing',
};

export const preShipment = {
  Waybill: WAYBILL,
  UserId: 'gig-user-1',
  CustomerCode: 'IND405919',
  SenderName: 'Store',
  ReceiverName: 'Audu Emmanuel',
  ReceiverPhoneNumber: '+2348037608805',
  ReceiverAddress: 'ABAKALIKI => ABAKALIKI (CENTRAL PARK)',
  ReceiverState: 'EBONYI',
  IsHomeDelivery: false,
  IsCancelled: false,
  GrandTotal: 45852.2,
};

export type QueryResult = { data: unknown; error: unknown };

export function createSupabase(
  tables: Record<string, QueryResult[]>,
  rpcResult: QueryResult = { data: SHIPMENT_ID, error: null }
) {
  const queues = new Map(
    Object.entries(tables).map(([table, results]) => [table, [...results]])
  );
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const supabase = {
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'neq', 'not', 'limit']) {
        builder[method] = vi.fn(() => builder);
      }
      builder.maybeSingle = vi.fn(() => {
        const next = queues.get(table)?.shift();
        if (!next) throw new Error(`Unexpected query on ${table}`);
        return Promise.resolve(next);
      });
      return builder;
    }),
    rpc,
  };
  return { rpc, supabase: supabase as unknown as SupabaseClient };
}

export function linkableTables(overrides: Record<string, QueryResult[]> = {}) {
  return {
    orders: [
      { data: order, error: null },
      { data: null, error: null },
    ],
    merchant_feature_settings: [
      { data: { shipping_providers: ['gigl'] }, error: null },
    ],
    shipments: [
      { data: null, error: null },
      { data: null, error: null },
    ],
    ...overrides,
  };
}

export function request(
  body: unknown,
  orderId = ORDER_ID
): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(
      `http://localhost/api/orders/${orderId}/shipping/gigl-waybill`,
      {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers: { Authorization: 'Bearer token' },
      }
    ),
    { params: Promise.resolve({ id: orderId }) },
  ];
}

export function signIn(
  supabase: SupabaseClient,
  permissions = { full_access: { all: true } },
  isOwner = true
) {
  vi.mocked(authenticateApiRequest).mockResolvedValue({
    user: { id: 'user-1' },
    error: null,
    supabase,
  } as never);
  vi.mocked(getMerchantForApiRequest).mockResolvedValue({
    merchantId: MERCHANT_ID,
    staffAccess: {
      isOwner,
      isStaff: !isOwner,
      role: isOwner ? null : 'sales',
      permissions,
    },
  } as never);
}

export function gigFinds(
  overrides: Partial<typeof preShipment> = {},
  account = ACCOUNT
) {
  vi.mocked(giglProvider.lookupExternalWaybill).mockResolvedValue({
    status: 'found',
    account,
    preShipment: giglPreShipment({ ...preShipment, ...overrides }),
    tracking: null,
  });
}

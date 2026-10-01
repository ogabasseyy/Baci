import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProviderQuotes: vi.fn(),
  bookShipment: vi.fn(),
  getRepairCenterAddress: vi.fn(),
}));

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    getProviderQuotes: mocks.getProviderQuotes,
    bookShipment: mocks.bookShipment,
  },
}));

vi.mock('@/lib/repairs/repair-center-address', () => {
  class RepairCenterLookupError extends Error {
    constructor(message = 'Repair center lookup failed') {
      super(message);
      this.name = 'RepairCenterLookupError';
    }
  }
  return {
    RepairCenterLookupError,
    getRepairCenterAddress: mocks.getRepairCenterAddress,
  };
});

export const merchantId = 'm-1';
export const repairId = 'r-1';

export const repairRow = {
  id: repairId,
  merchant_id: merchantId,
  customer_name: 'Ada Lovelace',
  customer_email: 'ada@example.com',
  customer_phone: '08012345678',
  device_type: 'Smartphone',
  device_model: 'iPhone 15',
  pickup_address: '12 Aba Road, Port Harcourt, Rivers',
  shipment_id: null,
  pickup_fee: 3500,
  pickup_payment_status: 'paid',
  pickup_payment_reference: 'RPU-ABC123DEF45678',
  quoted_price: 45_000,
  status: 'confirmed',
};

export const repairCenter = {
  name: 'Ogabassey Repair Center',
  phone: '09070007000',
  email: 'repairs@ogabassey.com',
  address: '3 Olayeni Street',
  city: 'Ikeja',
  state: 'Lagos',
  country: 'Nigeria',
  countryCode: 'NG',
};

export const sampleQuote = {
  id: 'q-1',
  provider: 'GIGL' as const,
  serviceTier: 'GoStandard',
  carrierName: 'GIG Logistics',
  displayName: 'GIG Logistics - GoStandard',
  estimatedDays: 3,
  price: 3500,
  currency: 'NGN' as const,
  pickupIncluded: true,
  insuranceIncluded: true,
  providerRateId: '0:0:12:4',
  expiresAt: new Date('2099-07-09T00:00:00.000Z'),
  rawResponse: { cost: 350_000 },
};

export const bookingResult = {
  provider: 'GIGL' as const,
  providerShipmentId: '1349000000',
  trackingNumber: 'TRK-123',
  carrierName: 'GIG Logistics',
  status: 'booked' as const,
  pickupScheduledAt: new Date('2026-07-10T00:00:00.000Z'),
};

export type Responses = Record<string, { data: unknown; error: unknown }>;

export function makeSupabase(
  responses: Responses,
  operations: string[] = [],
  inserts: Array<{ table: string; payload: unknown }> = []
): SupabaseClient {
  return {
    rpc(name: string) {
      operations.push(`rpc.${name}`);
      return Promise.resolve(
        responses[`rpc.${name}`] ?? {
          data: null,
          error: { message: `missing rpc mock: ${name}` },
        }
      );
    },
    from(table: string) {
      let op = 'select';
      const builder = {
        select() {
          return builder;
        },
        insert(payload?: unknown) {
          op = 'insert';
          operations.push(`${table}.insert`);
          if (payload !== undefined) {
            inserts.push({ table, payload });
          }
          return builder;
        },
        update() {
          op = 'update';
          operations.push(`${table}.update`);
          return builder;
        },
        delete() {
          op = 'delete';
          operations.push(`${table}.delete`);
          return builder;
        },
        eq() {
          return builder;
        },
        is() {
          return builder;
        },
        not() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(responses[`${table}.select`]);
        },
        single() {
          return Promise.resolve(responses[`${table}.${op}`]);
        },
        // biome-ignore lint/suspicious/noThenProperty: test double mimics an awaited query builder
        then(
          onF: (value: unknown) => unknown,
          onR?: (error: unknown) => unknown
        ) {
          return Promise.resolve(responses[`${table}.${op}`]).then(onF, onR);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

export function happyResponses(overrides: Partial<Responses> = {}): Responses {
  return {
    'repairs.select': { data: repairRow, error: null },
    'repairs.update': { data: [{ id: repairId }], error: null },
    'rpc.claim_repair_pickup_booking': {
      data: [{ claimed: true, shipment_id: null, terminal: false }],
      error: null,
    },
    'rpc.release_rejected_repair_pickup_reservation': {
      data: true,
      error: null,
    },
    'rpc.release_repair_pickup_booking_claim': {
      data: true,
      error: null,
    },
    'repair_pickup_quotes.insert': { data: { id: 'pq-1' }, error: null },
    'repair_pickup_quotes.update': { data: null, error: null },
    'shipments.insert': { data: { id: 'ship-1' }, error: null },
    'shipments.delete': { data: [{ id: 'ship-1' }], error: null },
    'shipments.select': { data: null, error: null },
    'shipments.update': { data: { id: 'ship-1' }, error: null },
    ...overrides,
  };
}

export function arrangeHappyRepairPickup(): void {
  vi.clearAllMocks();
  mocks.getRepairCenterAddress.mockResolvedValue(repairCenter);
  mocks.getProviderQuotes.mockResolvedValue([sampleQuote]);
  mocks.bookShipment.mockResolvedValue(bookingResult);
}

export function getRepairPickupMocks(): typeof mocks {
  return mocks;
}

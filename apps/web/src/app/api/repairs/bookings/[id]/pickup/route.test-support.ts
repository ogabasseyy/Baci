import { vi } from 'vitest';

export const VALID_PICKUP_BOOKING_ID = '123e4567-e89b-12d3-a456-426614174000';

export const pickupRouteParams = Promise.resolve({
  id: VALID_PICKUP_BOOKING_ID,
});

type ManualRow = {
  admin_notes: string | null;
  shipment_id: string | null;
  pickup_booking_lock_token: string | null;
  pickup_booking_started_at: string | null;
  service_type: string;
};

export function manualPickupClient(
  exists: boolean,
  overrides: Partial<ManualRow> = {},
  updateMatched = true
) {
  const row: ManualRow = {
    admin_notes: 'prior',
    shipment_id: null,
    pickup_booking_lock_token: null,
    pickup_booking_started_at: null,
    service_type: 'pickup',
    ...overrides,
  };
  const orCalls: string[] = [];
  const updateEqCalls: [string, unknown][] = [];
  const updateTerminal = {
    eq(column: string, value: unknown) {
      updateEqCalls.push([column, value]);
      return this;
    },
    neq() {
      return this;
    },
    is() {
      return this;
    },
    or(filter: string) {
      orCalls.push(filter);
      return this;
    },
    select() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({
        data: updateMatched ? { id: VALID_PICKUP_BOOKING_ID } : null,
        error: null,
      });
    },
  };
  const update = vi.fn().mockReturnValue(updateTerminal);
  return {
    from() {
      const builder = {
        select() {
          return builder;
        },
        update,
        eq() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({
            data: exists ? row : null,
            error: null,
          });
        },
      };
      return builder;
    },
    update,
    orCalls,
    updateEqCalls,
  };
}

/**
 * Manual-pickup client double whose lookup or note-write fails, exercising the
 * server-error path in recordManualPickup.
 */
export function manualPickupClientFailure(stage: 'lookup' | 'update') {
  const failure = { data: null, error: { message: 'db down' } };
  return {
    from() {
      const builder = {
        select() {
          return builder;
        },
        update() {
          return {
            eq() {
              return this;
            },
            neq() {
              return this;
            },
            is() {
              return this;
            },
            or() {
              return this;
            },
            select() {
              return this;
            },
            maybeSingle() {
              return Promise.resolve(
                stage === 'update' ? failure : { data: null, error: null }
              );
            },
          };
        },
        eq() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve(
            stage === 'lookup'
              ? failure
              : {
                  data: {
                    admin_notes: 'prior',
                    shipment_id: null,
                    pickup_booking_lock_token: null,
                    pickup_booking_started_at: null,
                    service_type: 'pickup',
                  },
                  error: null,
                }
          );
        },
      };
      return builder;
    },
  };
}

export function authorizedPickupRequest(supabase: unknown = {}) {
  return { ok: true, access: { merchantId: 'm-1' }, supabase };
}

export function pickupRouteRequest(body?: unknown): Request {
  return new Request(
    `https://x/api/repairs/bookings/${VALID_PICKUP_BOOKING_ID}/pickup`,
    {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }
  );
}

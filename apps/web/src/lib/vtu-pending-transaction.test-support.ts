import { vi } from 'vitest';
import type { preparePendingVtuTransaction } from '@/lib/vtu-pending-transaction';

/**
 * Supabase stand-in for preparePendingVtuTransaction tests, shared by the
 * colocated suites so each stays focused (moved out of the main suite).
 */
export type PrepareSupabase = Parameters<
  typeof preparePendingVtuTransaction
>[0]['supabase'];

export function createMockSupabase({
  merchant = {},
  settings = {},
  settingsError = null,
  settingsRows,
  customer = {},
  linkRows,
  insertRow = {},
  insertRpcRow,
}: {
  customer?: Record<string, unknown>;
  insertRow?: Record<string, unknown>;
  insertRpcRow?: Record<string, unknown>;
  linkRows?: Record<string, unknown>[] | null;
  merchant?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  settingsError?: { message: string } | null;
  settingsRows?: Record<string, unknown>[] | null;
} = {}) {
  const mergedSettings = {
    vtu_enabled: true,
    vtu_airtime_enabled: true,
    paystack_enabled: true,
    korapay_enabled: true,
    ...settings,
  };
  const mergedCustomer = {
    id: 'customer-1',
    email: 'customer@example.com',
    first_name: 'Ada',
    last_name: 'Lovelace',
    phone: '08012345678',
    user_id: 'user-1',
    ...customer,
  };
  const mergedInsert = {
    id: 'vtu-1',
    amount: 1000,
    customer_identifier: null,
    metadata: {},
    request_reference: 'VTU-REF-123',
    status: 'pending',
    type: 'airtime',
    ...insertRow,
  };
  const single = vi.fn().mockResolvedValue({
    data: {
      id: 'merchant-1',
      slug: 'ogabassey',
      business_name: 'OgaBassey',
      ...merchant,
    },
    error: null,
  });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: mergedCustomer,
    error: null,
  });
  const insertSingle = vi.fn().mockResolvedValue({
    data: mergedInsert,
    error: null,
  });
  const insert = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({ single: insertSingle }),
  });
  // Phase 2 RPC boundary: settings ALWAYS come from the projection
  // RPC (both callers); link/insert RPCs serve the RLS-bound flags.
  const rpc = vi.fn((fn: string) => {
    if (fn === 'get_vtu_checkout_settings') {
      if (settingsError) {
        return Promise.resolve({ data: null, error: settingsError });
      }
      return Promise.resolve({
        data: settingsRows ?? [mergedSettings],
        error: null,
      });
    }
    if (fn === 'link_vtu_customer_by_email') {
      return Promise.resolve({
        data: linkRows ?? [mergedCustomer],
        error: null,
      });
    }
    if (fn === 'insert_prepared_vtu_transaction') {
      return Promise.resolve({
        data: [insertRpcRow ?? mergedInsert],
        error: null,
      });
    }
    throw new Error(`unexpected rpc ${fn}`);
  });

  const from = vi.fn((table: string) => {
    if (table === 'merchants') {
      return {
        select: vi.fn().mockReturnValue({
          // The merchant lookup is alias-aware and uses .maybeSingle();
          // keep .single() too for any other caller. Same resolved value.
          eq: vi.fn().mockReturnValue({ single, maybeSingle: single }),
        }),
      };
    }
    if (table === 'merchant_feature_settings') {
      // Dead by design (Phase 2): settings come from the projection
      // RPC. Any direct read throws loudly instead of passing.
      throw new Error('direct merchant_feature_settings reads are removed');
    }
    if (table === 'customers') {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ maybeSingle }),
          }),
        }),
      };
    }
    return { insert };
  });

  const supabase = { from, rpc } as unknown as PrepareSupabase;

  return { from, insert, rpc, supabase };
}

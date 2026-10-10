import type { SupabaseClient } from '@supabase/supabase-js';

interface FakeRow {
  items: unknown;
  expires_at: string;
  version: number;
}

interface RpcCall {
  name: string;
  params: Record<string, unknown>;
}

/**
 * In-memory stand-in for the mcp_guest_carts RPCs, mirroring the
 * migration contracts (outcomes, version gate, capacity gate, expiry):
 * creations with a NULL expected version conflict on any existing row and
 * fail 'full' past the row cap, updates need the current version on a
 * live row, deletes need the current version or NULL for unconditional.
 */
export function createFakeGuestCartSupabase() {
  const rows = new Map<string, FakeRow>();
  // Same 50000-row cap the migration enforces; tests lower it to stage a
  // full table without seeding fifty thousand rows.
  let capacityLimit = 50000;
  const calls: RpcCall[] = [];
  const transportErrors: { code: string; message: string }[] = [];
  let beforeRpc:
    | ((name: string, params: Record<string, unknown>) => void)
    | undefined;

  function fail(error: { code: string; message: string }) {
    return { data: null, error };
  }

  async function rpc(name: string, params: Record<string, unknown>) {
    calls.push({ name, params });
    const injected = transportErrors.shift();
    if (injected) return fail(injected);
    beforeRpc?.(name, params);
    if (name === 'get_mcp_guest_cart') {
      const row = rows.get(params.p_token as string);
      return { data: row ? [{ ...row }] : [], error: null };
    }
    if (name === 'upsert_mcp_guest_cart') {
      const token = params.p_token as string;
      if (!/^[a-f0-9]{64}$/.test(token))
        return fail({ code: '22023', message: 'invalid guest cart token' });
      if (!Array.isArray(params.p_items))
        return fail({ code: '22023', message: 'items must be an array' });
      // Mirror the SQL clamps so a store bug that skips its own limits
      // fails here instead of passing against a permissive double.
      if (params.p_items.length > 20)
        return fail({ code: '22023', message: 'guest cart holds at most 20 lines' });
      if (
        Date.parse(params.p_expires_at as string) >
        Date.now() + 8 * 86400000
      )
        return fail({ code: '22023', message: 'guest cart expiry exceeds retention' });
      if (
        !params.p_items.every(
          (line) =>
            typeof line === 'object' &&
            line !== null &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
              (line as { product_id?: unknown }).product_id as string
            ) &&
            Number.isInteger((line as { quantity?: unknown }).quantity) &&
            (line as { quantity: number }).quantity >= 1 &&
            (line as { quantity: number }).quantity <= 10
        )
      )
        return fail({ code: '22023', message: 'invalid guest cart line' });
      if (JSON.stringify(params.p_items).length > 8192)
        return fail({ code: '22023', message: 'guest cart payload exceeds size budget' });
      const expected = params.p_expected_version as number | null;
      const row = rows.get(token);
      if (expected === null || expected === undefined) {
        if (rows.size >= capacityLimit)
          return { data: [{ version: null, outcome: 'full' }], error: null };
        if (row) return { data: [{ version: null, outcome: 'conflict' }], error: null };
        rows.set(token, {
          items: params.p_items,
          expires_at: params.p_expires_at as string,
          version: 1,
        });
        return { data: [{ version: 1, outcome: 'ok' }], error: null };
      }
      if (!row)
        return { data: [{ version: null, outcome: 'missing' }], error: null };
      if (Date.parse(row.expires_at) <= Date.now())
        return { data: [{ version: row.version, outcome: 'expired' }], error: null };
      if (row.version !== expected)
        return { data: [{ version: row.version, outcome: 'conflict' }], error: null };
      const version = row.version + 1;
      rows.set(token, {
        items: params.p_items,
        expires_at: params.p_expires_at as string,
        version,
      });
      return { data: [{ version, outcome: 'ok' }], error: null };
    }
    if (name === 'delete_mcp_guest_cart') {
      const expected = params.p_expected_version as number | null;
      const row = rows.get(params.p_token as string);
      // NULL is deliberately unconditional (corrupt-row reclaim); a typed
      // version must match, and a missing key never deletes.
      if (row && (expected === null || row.version === expected)) {
        rows.delete(params.p_token as string);
        return { data: true, error: null };
      }
      return { data: false, error: null };
    }
    return fail({ code: '42883', message: `unknown function ${name}` });
  }

  return {
    supabase: { rpc } as unknown as SupabaseClient,
    rows,
    calls,
    /** Runs before each RPC; lets a test mutate rows mid-operation to stage a race. */
    intercept(callback: (name: string, params: Record<string, unknown>) => void) {
      beforeRpc = callback;
    },
    /** Fails the next RPC transport with a PostgREST-shaped error. */
    failNextRpc(error: { code: string; message: string }) {
      transportErrors.push(error);
    },
    /** Lowers the creation capacity gate so a test can stage a full table. */
    setCapacityLimit(limit: number) {
      capacityLimit = limit;
    },
  };
}

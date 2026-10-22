/** Test-only normal-role SQL adapter; not a PostgREST/Auth-provider conformance claim. */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PoolClient } from 'pg';
export function publicationRlsClient(
  actor: string,
  owner: <T>(fn: (c: PoolClient) => Promise<T>) => Promise<T>
): SupabaseClient {
  const safe = (name: string) => {
    if (!/^[a-z_]+$/.test(name)) throw Error('Invalid fixture identifier');
    return name;
  };
  const execute = async (sql: string, params: unknown[] = []) => {
    try {
      return {
        data: await owner(async (c) => (await c.query(sql, params)).rows),
        error: null,
      };
    } catch (error) {
      const e = error as { message: string; code?: string };
      return { data: null, error: { message: e.message, code: e.code } };
    }
  };
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: actor } }, error: null }),
    },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      const entries = Object.entries(args);
      const result = await execute(
        `SELECT public.${safe(name)}(${entries.map(([key], i) => `${safe(key)}=>$${i + 1}`).join(',')}) result`,
        entries.map(([, value]) => value)
      );
      return { ...result, data: result.data?.[0]?.result ?? null };
    },
    from: (table: string) => {
      let columns = '';
      let head = false;
      let count = false;
      let limit: number | undefined;
      let order: string | undefined;
      const filters: [string, unknown][] = [];
      const run = async (single = false) => {
        const selected = columns
          .split(',')
          .map((c) => {
            const a = c.trim().split(':');
            return a.length === 2
              ? `${safe(a[1])} AS ${safe(a[0])}`
              : safe(c.trim());
          })
          .join(',');
        const predicate = filters.length
          ? ` WHERE ${filters.map(([key], i) => `${safe(key)}=$${i + 1}`).join(' AND ')}`
          : '';
        const query = head
          ? `SELECT count(*)::int count FROM public.${safe(table)}${predicate}`
          : `SELECT to_jsonb(x) item FROM (SELECT ${selected} FROM public.${safe(table)}${predicate}${order ? ` ORDER BY ${safe(order)}` : ''}${limit ? ` LIMIT ${Math.floor(limit)}` : ''}) x`;
        const result = await execute(
          query,
          filters.map(([, value]) => value)
        );
        return {
          data: head
            ? null
            : single
              ? (result.data?.[0]?.item ?? null)
              : (result.data?.map((r) => r.item) ?? null),
          error: result.error,
          ...(count ? { count: result.data?.[0]?.count ?? 0 } : {}),
        };
      };
      const chain = {
        select: (
          value: string,
          options?: { head?: boolean; count?: string }
        ) => {
          columns = value;
          head = options?.head ?? false;
          count = options?.count === 'exact';
          return chain;
        },
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return chain;
        },
        order: (key: string) => {
          order = key;
          return chain;
        },
        limit: (n: number) => {
          limit = n;
          return chain;
        },
        single: () => run(true),
        maybeSingle: () => run(true),
        // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are intentionally awaitable.
        then: (
          onfulfilled: (value: Awaited<ReturnType<typeof run>>) => unknown,
          onrejected?: (e: unknown) => unknown
        ) => run().then(onfulfilled, onrejected),
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

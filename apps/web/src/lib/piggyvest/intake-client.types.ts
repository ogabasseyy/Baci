import type { SupabaseClient } from '@supabase/supabase-js';

declare const piggyvestIntakeClientBrand: unique symbol;

/**
 * The query surface the PiggyVest receiver's call graph is written against
 * (inbox record, quarantine record, event processing). It is NOT a Supabase
 * connection: `createPiggyvestIntakeClient` returns a facade that answers
 * only a fixed allowlist of queries through the restricted database login
 * (see webhook-intake-client.ts). The brand keeps any other client from
 * being passed into the receiver's call graph.
 *
 * All queries of one delivery share one database connection; the receiver
 * calls `dispose()` in a `finally` to close it.
 */
export type PiggyvestIntakeClient = SupabaseClient & {
  readonly [piggyvestIntakeClientBrand]: true;
  readonly dispose?: () => Promise<void>;
};

// PiggyVest primary-database pooler setting. It is read here, not in env.ts:
// env.ts is the byte-frozen credential authority checked by the event
// pipeline boundary contract (tools/events), so this optional, non-secret
// setting stays out of it.

// A Supabase project ref: the suffix Supavisor's session pooler needs on the
// database user (`<login>.<ref>`). See lib/piggyvest/primary-db-link.ts.
export const PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

/**
 * Raw pooler project ref, or undefined when pooler mode is off. Never fails
 * boot: PiggyVest ships dark, and a malformed ref fails closed only in the
 * PiggyVest database executors.
 */
export function readPiggyvestPrimaryDbPoolerProjectRef(
  source: Record<string, string | undefined> = process.env
): string | undefined {
  const ref = source.PIGGYVEST_PRIMARY_DB_POOLER_PROJECT_REF;
  return ref === '' ? undefined : ref;
}

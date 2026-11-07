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

// Forwarder mode: the DB host is a TCP passthrough relay, and the client must
// verify the Postgres certificate against the real Supabase direct host.
export const PIGGYVEST_PRIMARY_DB_TLS_SERVER_NAME_PATTERN =
  /^db\.[a-z0-9]{20}\.supabase\.co$/;

/**
 * Raw TLS server name, or undefined when forwarder mode is off (absent or
 * blank). A malformed value is returned unchanged so the PiggyVest database
 * executors fail closed; it never fails boot.
 */
export function readPiggyvestPrimaryDbTlsServerName(
  source: Record<string, string | undefined> = process.env
): string | undefined {
  const name = source.PIGGYVEST_PRIMARY_DB_TLS_SERVER_NAME;
  return name === '' ? undefined : name;
}

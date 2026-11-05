/**
 * VPS service: piggyvest-db-forwarder
 * TCP passthrough from pg-relay.usebaci.com:15432 to the Supabase direct
 * Postgres host over IPv6 (Vercel is IPv4-only). TLS is end to end; this
 * process never terminates it. See docs/runbooks/piggyvest-db-forwarder.md.
 *
 * There is deliberately NO configuration: the upstream host, port and limits
 * are fixed in code so no environment value can repoint the forwarder.
 */

import { isEntrypoint } from '../lib/is-entrypoint.mjs';
import {
  createDbForwarder,
  DEFAULT_LIMITS,
  PRODUCTION_UPSTREAM,
} from '../lib/piggyvest-db-forwarder.mjs';

export const FORWARDER_PORT = 15432;

export async function runPiggyvestDbForwarder({
  log = (line) => console.log(`[piggyvest-db-forwarder] ${line}`),
  // Tests only (0 = ephemeral); the service always uses FORWARDER_PORT.
  port = FORWARDER_PORT,
  statsIntervalMs = 5 * 60_000,
} = {}) {
  const forwarder = createDbForwarder({
    listenPort: port,
    upstream: PRODUCTION_UPSTREAM,
    limits: DEFAULT_LIMITS,
    log,
  });
  const boundPort = await forwarder.listen();
  log(
    `listening on :${boundPort} upstream=${PRODUCTION_UPSTREAM.host}:${PRODUCTION_UPSTREAM.port}`
  );
  const timer = setInterval(() => {
    const { accepted, forwarded, active, rejected } = forwarder.stats();
    log(
      `stats accepted=${accepted} forwarded=${forwarded} active=${active} rejected=${JSON.stringify(rejected)}`
    );
  }, statsIntervalMs);
  timer.unref();
  return {
    ...forwarder,
    stop: async () => {
      clearInterval(timer);
      await forwarder.close();
    },
  };
}

if (isEntrypoint(import.meta.url)) {
  runPiggyvestDbForwarder().catch((error) => {
    console.error(
      `[piggyvest-db-forwarder] failed to start: ${error.code ?? 'error'}`
    );
    process.exit(1);
  });
}

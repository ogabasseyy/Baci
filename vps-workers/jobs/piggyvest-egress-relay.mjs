/**
 * VPS service: piggyvest-egress-relay
 * Forwards allowlisted, signed PiggyVest API calls from Vercel through this
 * host (the only IP PiggyVest accepts). Listens on 127.0.0.1 only; nginx
 * terminates TLS. See docs/runbooks/piggyvest-egress-relay.md.
 *
 * Config (systemd EnvironmentFile, not the shared worker .env):
 *   PIGGYVEST_EGRESS_RELAY_SECRET  shared HMAC secret (>= 32 chars); without
 *                                  it every request is refused (fail closed)
 *   PIGGYVEST_EGRESS_RELAY_UPSTREAM_TIMEOUT_MS  default 35000
 * The port is fixed (RELAY_PORT): nginx proxies to exactly that port, so there
 * is deliberately no override. The relay never holds the PiggyVest key: callers send their own.
 */

import { isEntrypoint } from '../lib/is-entrypoint.mjs';
import { createRelayServer } from '../lib/piggyvest-egress-relay-server.mjs';

const HOST = '127.0.0.1';
export const RELAY_PORT = 18910;

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function runPiggyvestEgressRelay({
  env = process.env,
  log = (line) => console.log(`[piggyvest-egress-relay] ${line}`),
  // Tests only (0 = ephemeral); the service always uses RELAY_PORT.
  port = RELAY_PORT,
} = {}) {
  const server = createRelayServer({
    secret: env.PIGGYVEST_EGRESS_RELAY_SECRET,
    log,
    limits: {
      upstreamTimeoutMs: positiveInt(
        env.PIGGYVEST_EGRESS_RELAY_UPSTREAM_TIMEOUT_MS,
        35_000
      ),
    },
  });
  server.listen(port, HOST, () => {
    const configured = (env.PIGGYVEST_EGRESS_RELAY_SECRET ?? '').length >= 32;
    log(`listening on ${HOST}:${port} configured=${configured}`);
  });
  return server;
}

if (isEntrypoint(import.meta.url)) {
  runPiggyvestEgressRelay();
}

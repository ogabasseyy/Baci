// Read-only smoke check for the PiggyVest egress relay: one signed GET of the
// bank list. Prints only the HTTP status and relay marker headers, never keys
// or bodies. Run with the values in the environment, for example:
//   PIGGYVEST_EGRESS_RELAY_URL=https://pv-egress.usebaci.com \
//   PIGGYVEST_EGRESS_RELAY_SECRET=... PIGGYVEST_SECRET_KEY=... \
//   node scripts/piggyvest-egress-relay-smoke.mjs
import { randomBytes } from 'node:crypto';
import { signRelayRequest } from '../lib/piggyvest-egress-relay-auth.mjs';

const base = process.env.PIGGYVEST_EGRESS_RELAY_URL;
const secret = process.env.PIGGYVEST_EGRESS_RELAY_SECRET;
const key = process.env.PIGGYVEST_SECRET_KEY;
if (!base || !secret || !key) {
  console.error(
    'Set PIGGYVEST_EGRESS_RELAY_URL, PIGGYVEST_EGRESS_RELAY_SECRET and PIGGYVEST_SECRET_KEY.'
  );
  process.exit(2);
}
const target = '/api/v1/transfer/bank-list';
const response = await fetch(new URL(target, base), {
  headers: {
    authorization: `Bearer ${key}`,
    'x-baci-relay-auth': signRelayRequest({
      secret,
      method: 'GET',
      target,
      timestamp: Math.floor(Date.now() / 1000),
      nonce: randomBytes(16).toString('hex'),
    }),
  },
  redirect: 'error',
});
console.log(`status=${response.status}`);
for (const name of ['x-baci-relay-error', 'x-baci-relay-upstream']) {
  console.log(`${name}=${response.headers.get(name) ?? '-'}`);
}
await response.body?.cancel();

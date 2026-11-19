import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { describe, it } from 'node:test';
import {
  createRelayServer,
  PRODUCTION_UPSTREAM,
} from './piggyvest-egress-relay-server.mjs';
import {
  call,
  listen,
  NOW_SECONDS,
  SECRET,
} from './piggyvest-egress-relay-test-support.mjs';

// PiggyVest allowlists only the VPS IPv4 address. api.piggyvest.business also
// publishes AAAA records, so an unpinned connection can leave over the VPS's
// IPv6 address and be refused as "Unrecognized Ip Address" (owner, 2026-11-16).
describe('piggyvest egress relay IPv4 pinning', () => {
  it('pins the production upstream to IPv4', () => {
    assert.equal(PRODUCTION_UPSTREAM.family, 4);
  });

  it('passes the upstream address family to every outgoing request', async () => {
    const seenFamilies = [];
    const upstream = {
      request: (options, ...rest) => {
        seenFamilies.push(options.family);
        return httpRequest({ ...options, family: undefined }, ...rest);
      },
      hostname: '127.0.0.1',
      port: 1,
      readyEvent: 'connect',
      family: 4,
    };
    const relay = createRelayServer({
      secret: SECRET,
      now: () => NOW_SECONDS * 1000,
      log: () => undefined,
      upstream,
    });
    const relayPort = await listen(relay);
    await call(relayPort, { target: '/api/v1/wallet/w1' });
    relay.close();
    assert.deepEqual(seenFamilies, [4]);
  });
});

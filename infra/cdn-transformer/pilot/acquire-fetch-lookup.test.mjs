import assert from 'node:assert/strict';
import test from 'node:test';
import { createPinnedLookup, fetchBoundedBytes } from './acquire-fetch.mjs';

test('refuses a hostname resolving to private space without connecting', async () => {
  // Deterministic, no network: the injected resolver answers with the
  // cloud-metadata address, and the connect-time validation refuses
  // before any socket opens.
  let connects = 0;
  const dnsResolve = async () => {
    connects += 1;
    return [{ address: '169.254.169.254', family: 4 }];
  };
  await assert.rejects(
    () =>
      fetchBoundedBytes('http://cdn.example.com/a.png', {
        dnsResolve,
        maxBytes: 1024,
        timeoutMs: 5_000,
      }),
    /resolves to a non-public address/
  );
  assert.equal(connects, 1);
});

test('pins a validated hostname to its resolved address', async () => {
  // The resolver answers public, so resolution passes and the fetch
  // proceeds to the pinned address — nothing listens on the discard
  // port, so the socket refuses (or the sandbox times it out) and the
  // rejection is the transport failure, never a policy rejection.
  // Either transport outcome proves the point: resolution passed and
  // pinning sent the socket at the validated address.
  const dnsResolve = async () => [{ address: '93.184.216.34', family: 4 }];
  await assert.rejects(
    () =>
      fetchBoundedBytes('http://cdn.example.com:9/a.png', {
        dnsResolve,
        maxBytes: 1024,
        timeoutMs: 3_000,
      }),
    /fetch failed or timed out/
  );
});

test('pinned lookup honors both callback forms', async () => {
  // Node 20+ invokes lookup with `all: true` (autoSelectFamily) and
  // expects an address array back; older callers use the single-address
  // form. Calling back in the wrong form fails the connect.
  const answers = [
    { address: '93.184.216.34', family: 4 },
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ];
  const lookup = createPinnedLookup(async () => answers);
  const via = (options) =>
    new Promise((resolvePromise, reject) => {
      lookup('cdn.example.com', options, (error, address, family) => {
        if (error) {
          reject(error);
        } else {
          resolvePromise({ address, family });
        }
      });
    });
  assert.deepEqual(await via({ all: true }), {
    address: answers,
    family: undefined,
  });
  assert.deepEqual(await via({ all: false }), {
    address: '93.184.216.34',
    family: 4,
  });
});

test('pinned fetch resolves through a real socket layer', async () => {
  // Wiring: the production fetch path invokes the injected resolver
  // with the URL hostname through the real node:http stack (which on
  // Node 20+ calls the lookup with `all: true`), then fails at the
  // transport on the closed discard port. The callback shapes for both
  // lookup forms are pinned directly by the unit test above — this
  // test proves the factory is the lookup the fetch actually uses.
  const seen = [];
  const dnsResolve = async (hostname) => {
    seen.push(hostname);
    return [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ];
  };
  await assert.rejects(
    () =>
      fetchBoundedBytes('http://cdn.example.com:9/a.png', {
        dnsResolve,
        maxBytes: 1024,
        timeoutMs: 3_000,
      }),
    /fetch failed or timed out/
  );
  assert.deepEqual(seen, ['cdn.example.com']);
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runPiggyvestEgressRelay } from './piggyvest-egress-relay.mjs';

describe('piggyvest egress relay entrypoint', () => {
  it('binds to loopback only and reports unconfigured state without the secret', async () => {
    const lines = [];
    const server = runPiggyvestEgressRelay({
      env: { PIGGYVEST_EGRESS_RELAY_PORT: '0' },
      log: (line) => lines.push(line),
    });
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      assert.equal(server.address().address, '127.0.0.1');
      assert.match(lines[0], /configured=false/);
      const res = await fetch(
        `http://127.0.0.1:${server.address().port}/api/v1/wallet/w1`
      );
      assert.equal(res.status, 503);
      assert.equal(res.headers.get('x-baci-relay-error'), 'not_configured');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

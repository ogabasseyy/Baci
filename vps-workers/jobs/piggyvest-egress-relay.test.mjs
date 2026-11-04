import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  RELAY_PORT,
  runPiggyvestEgressRelay,
} from './piggyvest-egress-relay.mjs';

describe('piggyvest egress relay entrypoint', () => {
  it('binds to loopback only and reports unconfigured state without the secret', async () => {
    const lines = [];
    const server = runPiggyvestEgressRelay({
      env: {},
      port: 0,
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

  it('uses the one port nginx proxies to, with no env override', () => {
    const conf = readFileSync(
      new URL('../config/piggyvest-egress-relay.nginx.conf', import.meta.url),
      'utf8'
    );
    assert.match(
      conf,
      new RegExp(`proxy_pass http://127\\.0\\.0\\.1:${RELAY_PORT};`)
    );
    const source = readFileSync(
      new URL('./piggyvest-egress-relay.mjs', import.meta.url),
      'utf8'
    );
    assert.doesNotMatch(source, /EGRESS_RELAY_PORT/);
  });
});

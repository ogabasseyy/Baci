import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const PROBE = join(scriptDir, 'probe-guest-cart-hook-reload.sh');

function startStub({ mgmt, canary }) {
  const hits = { mgmt: 0, canary: 0, notify: 0 };
  const notifies = [];
  let lastCanaryHeaders = null;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (
        req.method === 'POST' &&
        req.url === '/v1/projects/test/database/query'
      ) {
        hits.mgmt += 1;
        const parsed = JSON.parse(body);
        if (String(parsed.query || '').startsWith('NOTIFY')) {
          hits.notify += 1;
          notifies.push(parsed.query);
        }
        const [status, payload] = mgmt(parsed, hits.mgmt);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      } else if (
        req.method === 'POST' &&
        req.url === '/rest/v1/rpc/__guest_cart_hook_reload_canary__'
      ) {
        hits.canary += 1;
        lastCanaryHeaders = req.headers;
        const [status, payload] = canary(JSON.parse(body), hits.canary);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ code: 'PGRST204', message: 'Not found' }));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        hits,
        notifies,
        canaryHeaders: () => lastCanaryHeaders,
        port: server.address().port,
      });
    });
  });
}

function runProbe(env) {
  // Async spawn: the stub server shares this event loop, so a sync
  // spawn would block every stub response until curl timed out.
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [PROBE], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function baseEnv(port, overrides = {}) {
  return {
    SUPABASE_ACCESS_TOKEN: 'test-token',
    SUPABASE_PROJECT_REF: 'test',
    SUPABASE_MGMT_API_BASE: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    GUEST_CART_HOOK_PROBE_INTERVAL_S: '0',
    ...overrides,
  };
}

const ACK = {
  code: '42501',
  message: 'GUEST CART hook reload canary observed',
};
const NOT_LOADED = { code: 'PGRST204', message: 'Could not find the function' };

describe('probe-guest-cart-hook-reload', () => {
  for (const applied of ['1', 1]) {
    it(`skips fast when isolate is recorded (applied=${JSON.stringify(applied)})`, async () => {
      const stub = await startStub({
        mgmt: () => [200, [{ applied }]],
        canary: () => [200, ACK],
      });
      try {
        const result = await runProbe(baseEnv(stub.port));
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /already recorded; skipping/);
        assert.equal(stub.hits.canary, 0);
      } finally {
        stub.server.close();
      }
    });
  }

  it('acknowledges after a unanimous window of canary acks', async () => {
    const stub = await startStub({
      mgmt: () => [200, [{ applied: '0' }]],
      canary: (_body, hit) => {
        if (hit < 3) return [404, NOT_LOADED];
        // A 42501 with any other message is not the ack.
        if (hit === 3) return [403, { code: '42501', message: 'boom' }];
        return [403, ACK];
      },
    });
    try {
      const result = await runProbe(
        baseEnv(stub.port, {
          GUEST_CART_HOOK_PROBE_DEADLINE_S: '30',
          GUEST_CART_HOOK_PROBE_UNANIMITY_S: '2',
        })
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /acknowledged fleet-wide: 2s unanimous/);
      assert.ok(stub.hits.canary >= 4);
      assert.equal(stub.canaryHeaders().apikey, 'test-anon-key');
      // Both listener payloads: a replica that missed the
      // restore-time schema reload can never be healed by
      // config-only re-notifies.
      assert.deepEqual(stub.notifies, [
        "NOTIFY pgrst, 'reload config'",
        "NOTIFY pgrst, 'reload schema'",
      ]);
    } finally {
      stub.server.close();
    }
  });

  it('resets the unanimity clock on a stale answer', async () => {
    const stub = await startStub({
      mgmt: () => [200, [{ applied: '0' }]],
      canary: (_body, hit) => {
        if (hit === 4) return [404, NOT_LOADED];
        return [403, ACK];
      },
    });
    try {
      const result = await runProbe(
        baseEnv(stub.port, {
          GUEST_CART_HOOK_PROBE_DEADLINE_S: '30',
          GUEST_CART_HOOK_PROBE_UNANIMITY_S: '5',
        })
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /unanimity clock reset/);
      assert.match(result.stdout, /acknowledged fleet-wide/);
    } finally {
      stub.server.close();
    }
  });

  it('fails closed when acks never reach unanimity', async () => {
    const stub = await startStub({
      mgmt: () => [200, [{ applied: '0' }]],
      canary: (_body, hit) => (hit % 2 === 0 ? [404, NOT_LOADED] : [403, ACK]),
    });
    try {
      const result = await runProbe(
        baseEnv(stub.port, {
          GUEST_CART_HOOK_PROBE_DEADLINE_S: '3',
          GUEST_CART_HOOK_PROBE_UNANIMITY_S: '30',
        })
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /never reached 30s unanimous/);
      assert.match(result.stderr, /isolate grant is NOT applied/);
    } finally {
      stub.server.close();
    }
  });

  it('fails closed when the hook never loads', async () => {
    const stub = await startStub({
      mgmt: () => [200, [{ applied: '0' }]],
      canary: () => [404, NOT_LOADED],
    });
    try {
      const result = await runProbe(
        baseEnv(stub.port, { GUEST_CART_HOOK_PROBE_DEADLINE_S: '2' })
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /never served the GUEST CART hook reload canary/);
      assert.match(result.stderr, /isolate grant is NOT applied/);
      assert.ok(stub.hits.canary >= 1);
    } finally {
      stub.server.close();
    }
  });

  it('treats the unshadowed canary value as not-loaded', async () => {
    // Schema fresh but hook stale: the real canary RPC executes and
    // answers its bare constant (200 JSON string) instead of the
    // hook's 42501 denial. That middle state must never ack.
    const stub = await startStub({
      mgmt: () => [200, [{ applied: '0' }]],
      canary: () => [200, 'guest-cart-hook-canary-alive'],
    });
    try {
      const result = await runProbe(
        baseEnv(stub.port, { GUEST_CART_HOOK_PROBE_DEADLINE_S: '2' })
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /never served the GUEST CART hook reload canary/);
      assert.match(result.stderr, /isolate grant is NOT applied/);
      assert.ok(stub.hits.canary >= 1);
    } finally {
      stub.server.close();
    }
  });

  it('fails closed when PostgREST is unreachable', async () => {
    const stub = await startStub({
      mgmt: () => [200, [{ applied: '0' }]],
      canary: () => [200, ACK],
    });
    try {
      const closedPort = stub.port + 10000 > 65535 ? 9 : stub.port + 10000;
      const result = await runProbe(
        baseEnv(stub.port, {
          NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${closedPort}`,
          GUEST_CART_HOOK_PROBE_DEADLINE_S: '2',
        })
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /never served the GUEST CART hook reload canary/);
      assert.equal(stub.hits.canary, 0);
    } finally {
      stub.server.close();
    }
  });

  it('fails closed when the isolate check errors', async () => {
    const stub = await startStub({
      mgmt: () => [500, { message: 'mgmt down' }],
      canary: () => [200, ACK],
    });
    try {
      const result = await runProbe(baseEnv(stub.port));
      assert.equal(result.status, 1);
      assert.match(result.stderr, /could not check the isolate migration/);
      assert.equal(stub.hits.canary, 0);
    } finally {
      stub.server.close();
    }
  });

  it('fails closed on a malformed isolate response', async () => {
    const stub = await startStub({
      mgmt: () => [200, { applied: '0' }],
      canary: () => [200, ACK],
    });
    try {
      const result = await runProbe(baseEnv(stub.port));
      assert.equal(result.status, 1);
      assert.match(result.stderr, /unreadable isolate-migration response/);
    } finally {
      stub.server.close();
    }
  });

  it('pins the fleet-convergence defaults against silent weakening', () => {
    const script = readFileSync(PROBE, 'utf8');
    assert.match(script, /GUEST_CART_HOOK_PROBE_DEADLINE_S:-900}/);
    assert.match(script, /GUEST_CART_HOOK_PROBE_INTERVAL_S:-2}/);
    assert.match(script, /GUEST_CART_HOOK_PROBE_UNANIMITY_S:-300}/);
    assert.match(script, /GUEST_CART_HOOK_PROBE_RENOTIFY_S:-60}/);
  });
});

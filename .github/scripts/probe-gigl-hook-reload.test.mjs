import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const PROBE = join(scriptDir, 'probe-gigl-hook-reload.sh');

function startStub({ mgmt, canary }) {
  const hits = { mgmt: 0, canary: 0 };
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
        const [status, payload] = mgmt(JSON.parse(body), hits.mgmt);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(payload));
      } else if (
        req.method === 'POST' &&
        req.url === '/rest/v1/rpc/__gigl_hook_reload_canary__'
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
    GIGL_HOOK_PROBE_INTERVAL_S: '0',
    ...overrides,
  };
}

const ACK = {
  code: '42501',
  message: 'GIGL hook reload canary observed',
};
const NOT_LOADED = { code: 'PGRST204', message: 'Could not find the function' };

describe('probe-gigl-hook-reload', () => {
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

  it('acknowledges once PostgREST serves the canary', async () => {
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
        baseEnv(stub.port, { GIGL_HOOK_PROBE_DEADLINE_S: '30' })
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /acknowledged after 4 attempt/);
      assert.equal(stub.hits.canary, 4);
      assert.equal(stub.canaryHeaders().apikey, 'test-anon-key');
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
        baseEnv(stub.port, { GIGL_HOOK_PROBE_DEADLINE_S: '2' })
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /never served the GIGL hook reload canary/);
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
          GIGL_HOOK_PROBE_DEADLINE_S: '2',
        })
      );
      assert.equal(result.status, 1);
      assert.match(result.stderr, /never served the GIGL hook reload canary/);
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
});

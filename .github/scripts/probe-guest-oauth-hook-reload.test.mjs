import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import test from 'node:test';

for (const acknowledged of [true, false]) {
  test(`OAuth reload probe ${acknowledged ? 'requires fresh fleet evidence' : 'fails closed without an acknowledgement'}`, async () => {
    let canaries = 0;
    const queries = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (req.url === '/v1/projects/test/database/query') {
          queries.push(JSON.parse(body).query);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          // A recorded migration must never short-circuit this probe.
          res.end(JSON.stringify([{ applied: 1 }]));
        } else if (req.url === '/rest/v1/rpc/__guest_oauth_hook_reload_canary__') {
          canaries++;
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: '42501', message: acknowledged
            ? 'GUEST OAUTH hook reload canary observed' : 'other denial' }));
        } else { res.writeHead(404); res.end('{}'); }
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const port = server.address().port;
      const result = await new Promise((resolve, reject) => {
        const child = spawn('bash', [new URL('./probe-guest-oauth-hook-reload.sh', import.meta.url).pathname], {
          env: { ...process.env,
            SUPABASE_ACCESS_TOKEN: 'test-only', SUPABASE_PROJECT_REF: 'test',
            NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`,
            NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only',
            SUPABASE_MGMT_API_BASE: `http://127.0.0.1:${port}`,
            GUEST_OAUTH_HOOK_PROBE_ALLOW_UNBOUND_URL: '1',
            GUEST_OAUTH_HOOK_PROBE_DEADLINE_S: '3',
            GUEST_OAUTH_HOOK_PROBE_UNANIMITY_S: '1',
            GUEST_OAUTH_HOOK_PROBE_INTERVAL_S: '1',
          },
        });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, output }));
      });
      assert.equal(result.code, acknowledged ? 0 : 1, result.output);
      assert.ok(canaries >= 2);
      assert.ok(queries.includes("NOTIFY pgrst, 'reload config'"));
      assert.ok(queries.includes("NOTIFY pgrst, 'reload schema'"));
      assert.ok(queries.every((query) => query.startsWith('NOTIFY')));
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
}

for (const url of ['https://wrong.supabase.co', 'https://test.supabase.co:443@wrong.example']) {
  test(`rejects a substituted project destination: ${url}`, async () => {
    const result = await new Promise((resolve, reject) => {
      const child = spawn('bash', [new URL('./probe-guest-oauth-hook-reload.sh', import.meta.url).pathname], {
        env: { ...process.env, SUPABASE_ACCESS_TOKEN: 'test-only', SUPABASE_PROJECT_REF: 'test',
          NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only',
          GUEST_OAUTH_HOOK_PROBE_ALLOW_UNBOUND_URL: '', },
      });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, output }));
    });
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Invalid guest OAuth probe URL|does not match project ref/);
    assert.doesNotMatch(result.output, /acknowledged fleet-wide/);
  });
}

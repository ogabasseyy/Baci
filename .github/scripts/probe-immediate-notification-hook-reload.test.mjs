import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const script = fileURLToPath(new URL('./probe-immediate-notification-hook-reload.sh', import.meta.url));

async function withServer(canary, action) {
  const queries = [];
  let canaryRequests = 0;
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      response.setHeader('content-type', 'application/json');
      if (request.url === '/v1/projects/test/database/query') {
        queries.push(JSON.parse(body).query);
        response.end('[]');
      } else if (request.url === '/rest/v1/rpc/__immediate_notification_redrive_complete_hook_canary__') {
        response.statusCode = 403;
        canaryRequests += 1;
        response.end(JSON.stringify(typeof canary === 'function' ? canary(canaryRequests) : canary));
      } else { response.statusCode = 404; response.end('{}'); }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await action(server.address().port, queries); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function run(port, extra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [script], { env: {
      ...process.env,
      NODE_ENV: 'test', SUPABASE_ACCESS_TOKEN: 'fixture-token', SUPABASE_PROJECT_REF: 'test',
      SUPABASE_MGMT_API_BASE: `http://127.0.0.1:${port}`,
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon',
      IMMEDIATE_NOTIFICATION_PROBE_ALLOW_LOCAL_TEST: '1',
      IMMEDIATE_NOTIFICATION_PROBE_DEADLINE_S: '3',
      IMMEDIATE_NOTIFICATION_PROBE_UNANIMITY_S: '1',
      IMMEDIATE_NOTIFICATION_PROBE_INTERVAL_S: '0',
      ...extra,
    } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, output }));
  });
}

test('accepts only the complete-hook acknowledgement and re-notifies both reload channels', async () => {
  await withServer({ code: '42501', message: 'IMMEDIATE NOTIFICATION COMPLETE hook reload canary observed' }, async (port, queries) => {
    const result = await run(port);
    assert.equal(result.status, 0, result.output);
    assert.ok(queries.some((query) => query.includes('reload config') && query.includes('reload schema')));
    assert.doesNotMatch(result.output, /fixture-token|fixture-anon/);
  });
});

test('rejects a stale hook and does not allow local endpoints outside tests', async () => {
  await withServer({ code: 'PGRST202', message: 'not found' }, async (port) => {
    assert.notEqual((await run(port, { IMMEDIATE_NOTIFICATION_PROBE_DEADLINE_S: '1' })).status, 0);
    assert.notEqual((await run(port, { NODE_ENV: 'production' })).status, 0);
  });
});

test('a stale replica resets the acknowledgement window', async () => {
  const alternating = (count) => count % 2
    ? { code: '42501', message: 'IMMEDIATE NOTIFICATION COMPLETE hook reload canary observed' }
    : { code: 'PGRST202', message: 'stale' };
  await withServer(alternating, async (port) => {
    const result = await run(port, { IMMEDIATE_NOTIFICATION_PROBE_DEADLINE_S: '2' });
    assert.notEqual(result.status, 0, result.output);
  });
});

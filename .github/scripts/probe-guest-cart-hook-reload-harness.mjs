import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const PROBE = join(scriptDir, 'probe-guest-cart-hook-reload.sh');

export function startStub({ mgmt, canary }) {
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

export function runProbe(env) {
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

export function baseEnv(port, overrides = {}) {
  return {
    SUPABASE_ACCESS_TOKEN: 'test-token',
    SUPABASE_PROJECT_REF: 'test',
    SUPABASE_MGMT_API_BASE: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
    GUEST_CART_HOOK_PROBE_INTERVAL_S: '0',
    // The stub is not a supabase.co URL: every stubbed run opts into
    // the explicit unbound-URL hatch (the deploy workflow never sets it).
    GUEST_CART_HOOK_PROBE_ALLOW_UNBOUND_URL: '1',
    ...overrides,
  };
}

export const ACK = {
  code: '42501',
  message: 'GUEST CART hook reload canary observed',
};
export const NOT_LOADED = {
  code: 'PGRST204',
  message: 'Could not find the function',
};


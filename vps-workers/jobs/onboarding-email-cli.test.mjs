import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('onboarding CLI runs from the worker launcher with a disabled empty queue', {
  timeout: 30000,
}, async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.writeHead(
      request.url === '/rest/v1/rpc/claim_merchant_onboarding_email_jobs'
        ? 200
        : 500,
      { 'Content-Type': 'application/json' }
    );
    response.end('[]');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const child = spawn(
      process.execPath,
      [
        join(root, 'node_modules/tsx/dist/cli.mjs'),
        'src/scripts/process-merchant-onboarding-emails.ts',
      ],
      {
        cwd: join(root, 'apps/web'),
        env: {
          ...process.env,
          NODE_OPTIONS: '--conditions=react-server',
          DOTENV_CONFIG_PATH: '/dev/null',
          NEXT_PUBLIC_APP_URL: 'https://usebaci.test',
          NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${address.port}`,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-fixture-anon',
          SUPABASE_SERVICE_ROLE_KEY: 'local-fixture-worker',
          ZEPTOMAIL_TOKEN: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    const code = await new Promise((resolve, reject) => {
      child.once('close', resolve);
      child.once('error', reject);
    });
    assert.equal(code, 0, output);
    assert.deepEqual(requests, [
      '/rest/v1/rpc/claim_merchant_onboarding_email_jobs',
    ]);
    assert.match(output, /"processed":0/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

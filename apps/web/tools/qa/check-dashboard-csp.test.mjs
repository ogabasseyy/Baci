import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';

async function runCheck(executableNonce) {
  let request = 0;
  const server = createServer((_req, res) => {
    const nonce = `test-${++request}`;
    res.setHeader('Content-Security-Policy', `script-src 'nonce-${nonce}'`);
    res.end(
      `<script nonce="${nonce}">0</script>
       <script type="application/javascript"${executableNonce ? ` nonce="${nonce}"` : ''}>0</script>
       <script type="application/ld+json">{}</script>`
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        new URL('./check-dashboard-csp.mjs', import.meta.url).pathname,
        `http://127.0.0.1:${server.address().port}`,
      ]);
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stderr }));
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('requires a nonce on application/javascript even beside a valid script', async () => {
  const result = await runCheck(false);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /missing the current response nonce/);
});

test('accepts executable scripts with matching nonces and inert JSON-LD', async () => {
  assert.equal((await runCheck(true)).code, 0);
});

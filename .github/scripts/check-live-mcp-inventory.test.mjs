import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DEFAULT_REQUIRED_TOOLS } from './mcp-tool-inventory.mjs';

async function runSmoke(toolNames, requiredTools = '') {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url === '/health'
      ? { status: 'healthy' }
      : { jsonrpc: '2.0', id: 1, result: { tools: toolNames.map((name) => ({ name })) } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./check-live-mcp-tools.mjs', import.meta.url))], {
      env: {
        ...process.env,
        MCP_HEALTH_URL: `http://127.0.0.1:${port}/health`,
        MCP_SMOKE_URL: `http://127.0.0.1:${port}/mcp`,
        MCP_REQUIRED_TOOLS: requiredTools,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    const [code] = await once(child, 'close');
    return { code, output };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('accepts the current inventory without the retired alias', async () => {
  const result = await runSmoke(DEFAULT_REQUIRED_TOOLS);
  assert.equal(result.code, 0, result.output);
});

test('fails when the persistent guest cart tool is missing', async () => {
  const result = await runSmoke(DEFAULT_REQUIRED_TOOLS.filter((name) => name !== 'update_ogabassey_guest_cart'));
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Missing tools: update_ogabassey_guest_cart/);
});

test('fails when the misleading retired alias is still advertised', async () => {
  const result = await runSmoke([...DEFAULT_REQUIRED_TOOLS, 'add_to_cart']);
  assert.notEqual(result.code, 0);
  assert.match(result.output, /Retired tools: add_to_cart/);
});

test('honors an explicit inventory override for another MCP server', async () => {
  const result = await runSmoke(['add_to_cart'], 'add_to_cart');
  assert.equal(result.code, 0, result.output);
});

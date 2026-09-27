import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./deploy-mcp-server.sh', import.meta.url));

test('MCP deploy bundle includes the Docker secret-exclusion rules', () => {
  const output = execFileSync(script, [], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MCP_DRY_RUN: '1',
      MCP_VPS_HOST: 'example.invalid',
      MCP_VPS_USER: 'test',
    },
    timeout: 30_000,
  });

  assert.match(output, /^\.dockerignore$/m);
});

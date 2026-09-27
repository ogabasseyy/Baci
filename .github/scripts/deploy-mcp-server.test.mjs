import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import YAML from 'yaml';

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

test('Docker ignore edits trigger the deployment-script CI gate', () => {
  const filters = YAML.parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  assert.ok(filters.deploy_scripts.includes('.dockerignore'));
});

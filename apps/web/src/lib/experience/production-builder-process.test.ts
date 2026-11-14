// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('imports the server-only stack in a real Node process with the dedicated operator configuration', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "await import('./src/lib/experience/production-builder-stack.ts'); console.log('STACK_IMPORT_OK')",
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        TSX_TSCONFIG_PATH: 'tools/builder-production/tsconfig.json',
      },
    }
  );
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toContain('STACK_IMPORT_OK');
});

it('preserves the normal server-only guard outside the operator configuration', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "await import('./src/lib/experience/production-builder-stack.ts')",
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        TSX_TSCONFIG_PATH: 'tsconfig.json',
      },
    }
  );
  expect(child.status).not.toBe(0);
  expect(child.stderr).toContain(
    'This module cannot be imported from a Client Component'
  );
});

it('starts and stops the combined service in a separate Node process', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'tools/builder-preview-spike/production-stack-process.fixture.ts',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 30000,
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        TSX_TSCONFIG_PATH: 'tools/builder-production/tsconfig.json',
      },
    }
  );
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout).toContain('STACK_LIFECYCLE_OK');
});

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorefrontEdgeInventoryFixture } from './storefront-edge-inventory.test-support';

const execFileAsync = promisify(execFile);
const toolDirectory = dirname(fileURLToPath(import.meta.url));
const tsxCliPath = createRequire(import.meta.url).resolve('tsx/cli');
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true }))
  );
});

describe('createStorefrontEdgeInventory CLI', () => {
  it('creates and validates an artifact through the installed tsx runtime', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'storefront-edge-cli-'));
    temporaryRoots.push(repoRoot);
    const originMainSha = await createStorefrontEdgeInventoryFixture(repoRoot);
    const output = join(repoRoot, 'task-1a-inventory.json');
    const created = await execFileAsync(process.execPath, [
      tsxCliPath,
      join(toolDirectory, 'create-storefront-edge-inventory-cli.ts'),
      '--repo-root',
      repoRoot,
      '--source-sha',
      originMainSha,
      '--pilot-hostname',
      'pilot.usebaci.com',
      '--posthog-relay-path',
      '/baci-relay',
      '--output',
      output,
    ]);
    const validated = await execFileAsync(process.execPath, [
      tsxCliPath,
      join(toolDirectory, 'validate-storefront-edge-inventory.ts'),
      '--repo-root',
      repoRoot,
      '--source-sha',
      originMainSha,
      '--input',
      output,
      '--pilot-hostname',
      'pilot.usebaci.com',
      '--posthog-relay-path',
      '/baci-relay',
    ]);
    expect(JSON.parse(created.stdout)).toEqual(
      expect.objectContaining({ rowCount: expect.any(Number) })
    );
    expect(JSON.parse(validated.stdout)).toEqual(
      expect.objectContaining({ storefrontEntrypointCount: 77 })
    );
  }, 60_000);
});

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorefrontEdgeInventoryFixture } from './storefront-edge-inventory.test-support';

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);
const toolDirectory = dirname(fileURLToPath(import.meta.url));
const tsxCliPath = createRequire(import.meta.url).resolve('tsx/cli');

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('create-storefront-edge-inventory CLI options', () => {
  it.each([
    'unknown',
    'duplicate',
  ])('rejects %s generator options', async (label) => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'storefront-edge-options-'));
    temporaryRoots.push(repoRoot);
    const originMainSha = await createStorefrontEdgeInventoryFixture(repoRoot);
    const output = join(repoRoot, 'task-1a-inventory.json');
    const extraArguments =
      label === 'unknown'
        ? ['--unexpected', 'value']
        : ['--source-sha', originMainSha];

    await expect(
      execFileAsync(process.execPath, [
        tsxCliPath,
        join(toolDirectory, 'create-storefront-edge-inventory-cli.ts'),
        '--repo-root',
        repoRoot,
        '--source-sha',
        originMainSha,
        '--pilot-hostname',
        'pilot.usebaci.com',
        '--output',
        output,
        ...extraArguments,
      ])
    ).rejects.toThrow('inventory options are invalid');
  }, 60_000);
});

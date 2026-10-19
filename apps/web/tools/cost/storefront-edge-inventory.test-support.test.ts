import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createStorefrontEdgeInventoryFixture } from './storefront-edge-inventory.test-support';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, {
      force: true,
      maxRetries: 5,
      recursive: true,
      retryDelay: 100,
    });
  }
});

describe('createStorefrontEdgeInventoryFixture', () => {
  it('isolates fixture commits from hostile ambient Git settings', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'storefront-edge-fixture-'));
    temporaryDirectories.push(directory);
    const globalConfig = join(directory, 'gitconfig');
    const hooksDirectory = join(directory, 'hooks');
    await writeFile(
      globalConfig,
      `[commit]\n\tgpgsign = true\n[core]\n\thooksPath = ${hooksDirectory}\n`
    );
    await mkdir(hooksDirectory, { recursive: true });
    await writeFile(join(hooksDirectory, 'pre-commit'), '#!/bin/sh\nexit 1\n');
    await chmod(join(hooksDirectory, 'pre-commit'), 0o700);
    const previousGlobalConfig = process.env.GIT_CONFIG_GLOBAL;
    process.env.GIT_CONFIG_GLOBAL = globalConfig;

    try {
      const commitSha = await createStorefrontEdgeInventoryFixture(directory);
      expect(commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(await readFile(join(directory, '.git', 'HEAD'), 'utf8')).toContain(
        'refs/heads/'
      );
    } finally {
      if (previousGlobalConfig === undefined)
        delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previousGlobalConfig;
    }
  });
});

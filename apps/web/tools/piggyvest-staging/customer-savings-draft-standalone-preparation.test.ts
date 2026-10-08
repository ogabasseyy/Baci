import { execFileSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertCustomerSavingsDraftSnapshotDestination,
  createCustomerSavingsDraftSourceManifest,
  createCustomerSavingsDraftSourceSnapshot,
  verifyCustomerSavingsDraftStandaloneOutput,
} from './customer-savings-draft-standalone-preparation';

const temporaryDirectories: string[] = [];
const originalPath = process.env.PATH;

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('createCustomerSavingsDraftSourceManifest', () => {
  it('includes uncommitted funding endpoints and their schema and device dependencies', () => {
    const paths = [
      'apps/web/src/app/api/storefront/customer/savings/funding/route.ts',
      'apps/web/src/app/api/storefront/customer/savings/goals/prepare-create-savings-goal-device.ts',
      'apps/web/src/schemas/piggyvest-savings-plan-funding.ts',
      'apps/web/src/schemas/piggyvest-provisioning-configuration.ts',
      'apps/web/src/schemas/piggyvest-postgres-configuration.ts',
      'apps/web/src/schemas/hosted-funding-environment.ts',
      'apps/web/src/lib/hosted-savings-environment.ts',
      'apps/web/src/schemas/cancellation-recovery.ts',
      'apps/web/src/components/storefront/piggyvest-savings/funding-panel.tsx',
      'packages/shared/src/contracts/piggyvest-funding-display.ts',
      'packages/shared/src/contracts/piggyvest-policy-review.ts',
      'packages/shared/src/schemas/piggyvest-cancellation-client.ts',
    ];
    expect(
      createCustomerSavingsDraftSourceManifest({
        trackedPaths: [],
        untrackedPaths: paths,
      }).files
    ).toEqual(
      [...paths].sort().map((path) => ({ path, source: 'untracked-required' }))
    );
  });
  it('includes tracked source and only the named untracked savings dependencies', () => {
    const manifest = createCustomerSavingsDraftSourceManifest({
      trackedPaths: [
        'apps/web/package.json',
        'apps/web/src/env.ts',
        'apps/web/.env.production',
        'apps/web/.next/cache/build-state',
      ],
      untrackedPaths: [
        'apps/web/src/config/hosted-draft-standalone-output.ts',
        'apps/web/src/app/api/storefront/customer/savings/drafts/route.ts',
        'apps/web/src/lib/customer-savings-draft-runtime-gate.ts',
        'apps/web/src/lib/piggyvest/plan-wallets.ts',
        'apps/web/src/schemas/customer-savings-draft.ts',
        'apps/web/src/schemas/hosted-draft-environment.ts',
        'apps/web/src/schemas/hosted-draft-environment.test.ts',
        'apps/web/src/env-hosted-drafts.test.ts',
        'apps/web/tools/piggyvest-staging/customer-draft-nginx-locations.ts',
        'supabase/migrations/20260918120000_piggyvest_plan_wallets.sql',
        'apps/web/.env.local',
        'apps/web/.next/server/app.js',
        '.playwright-cli/state.json',
      ],
    });

    expect(manifest.files).toEqual([
      { path: 'apps/web/package.json', source: 'tracked' },
      {
        path: 'apps/web/src/app/api/storefront/customer/savings/drafts/route.ts',
        source: 'untracked-required',
      },
      {
        path: 'apps/web/src/config/hosted-draft-standalone-output.ts',
        source: 'untracked-required',
      },
      {
        path: 'apps/web/src/env-hosted-drafts.test.ts',
        source: 'untracked-required',
      },
      { path: 'apps/web/src/env.ts', source: 'tracked' },
      {
        path: 'apps/web/src/lib/customer-savings-draft-runtime-gate.ts',
        source: 'untracked-required',
      },
      {
        path: 'apps/web/src/lib/piggyvest/plan-wallets.ts',
        source: 'untracked-required',
      },
      {
        path: 'apps/web/src/schemas/customer-savings-draft.ts',
        source: 'untracked-required',
      },
      {
        path: 'apps/web/src/schemas/hosted-draft-environment.test.ts',
        source: 'untracked-required',
      },
      {
        path: 'apps/web/src/schemas/hosted-draft-environment.ts',
        source: 'untracked-required',
      },
      {
        path: 'apps/web/tools/piggyvest-staging/customer-draft-nginx-locations.ts',
        source: 'untracked-required',
      },
      {
        path: 'supabase/migrations/20260918120000_piggyvest_plan_wallets.sql',
        source: 'untracked-required',
      },
    ]);
  });
});

describe('verifyCustomerSavingsDraftStandaloneOutput', () => {
  it('uses the nested monorepo server and asset roots', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'standalone-output-test-'));
    temporaryDirectories.push(directory);
    const standaloneRoot = join(directory, '.next/standalone');
    const applicationRoot = join(standaloneRoot, 'apps/web');
    await mkdir(join(applicationRoot, '.next/static'), { recursive: true });
    await mkdir(join(applicationRoot, 'public'), { recursive: true });
    await writeFile(join(applicationRoot, 'server.js'), '');

    await expect(
      verifyCustomerSavingsDraftStandaloneOutput(standaloneRoot)
    ).resolves.toEqual({
      applicationRoot,
      serverPath: join(applicationRoot, 'server.js'),
    });
  });

  it('rejects the flat root-server layout assumed by a single-app recipe', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'standalone-output-test-'));
    temporaryDirectories.push(directory);
    const standaloneRoot = join(directory, '.next/standalone');
    await mkdir(join(standaloneRoot, '.next/static'), { recursive: true });
    await mkdir(join(standaloneRoot, 'public'), { recursive: true });
    await writeFile(join(standaloneRoot, 'server.js'), '');

    await expect(
      verifyCustomerSavingsDraftStandaloneOutput(standaloneRoot)
    ).rejects.toThrow('apps/web/server.js');
  });
});

describe('customer savings draft source snapshot destination', () => {
  it('refuses an existing file or directory without changing it', async () => {
    const directory = await createSnapshotRepository();
    temporaryDirectories.push(directory);
    const repositoryRoot = join(directory, 'repository');
    const destinations = [
      join(directory, 'existing-directory'),
      join(directory, 'existing-file'),
    ];
    await mkdir(destinations[0]);
    await writeFile(join(destinations[0], 'marker'), 'preserve directory');
    await writeFile(destinations[1], 'preserve file');

    for (const destination of destinations) {
      await expect(
        createCustomerSavingsDraftSourceSnapshot({
          repositoryRoot,
          destination,
        })
      ).rejects.toThrow('Snapshot destination already exists');
    }

    await expect(
      readFile(join(destinations[0], 'marker'), 'utf8')
    ).resolves.toBe('preserve directory');
    await expect(readFile(destinations[1], 'utf8')).resolves.toBe(
      'preserve file'
    );
  });

  it('refuses a repository ancestor and the filesystem root', async () => {
    const directory = await createSnapshotRepository();
    temporaryDirectories.push(directory);
    const repositoryRoot = join(directory, 'repository');

    expect(() =>
      assertCustomerSavingsDraftSnapshotDestination(repositoryRoot, directory)
    ).toThrow('outside the repository');
    expect(() =>
      assertCustomerSavingsDraftSnapshotDestination(
        repositoryRoot,
        parse(directory).root
      )
    ).toThrow('filesystem root');
  });

  it('accepts a tracked inventory larger than the default child-process buffer', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'large-source-inventory-test-')
    );
    temporaryDirectories.push(directory);
    const repositoryRoot = join(directory, 'repository');
    const fakeBin = join(directory, 'bin');
    const destination = join(directory, 'snapshot');
    await mkdir(repositoryRoot);
    await mkdir(fakeBin);
    await writeFile(join(repositoryRoot, 'tracked.txt'), 'tracked source');
    await writeFile(
      join(fakeBin, 'git'),
      `#!/bin/sh\nif [ "$1" = "rev-parse" ]; then printf '%040d\\n' 0; exit 0; fi\ni=0\nwhile [ "$i" -lt 120000 ]; do printf 'tracked.txt\\0'; i=$((i + 1)); done\n`
    );
    await chmod(join(fakeBin, 'git'), 0o755);
    vi.stubEnv('PATH', `${fakeBin}:${process.env.PATH ?? ''}`);

    await expect(
      createCustomerSavingsDraftSourceSnapshot({
        repositoryRoot,
        destination,
      })
    ).resolves.toMatchObject({ revision: '0'.repeat(40) });
    await expect(
      readFile(join(destination, 'tracked.txt'), 'utf8')
    ).resolves.toBe('tracked source');
  });

  it('does not leave the synthetic git executable on PATH after the inventory test', () => {
    expect(process.env.PATH).toBe(originalPath);
  });
});

async function createSnapshotRepository(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'source-snapshot-test-'));
  const repositoryRoot = join(directory, 'repository');
  await mkdir(repositoryRoot);
  await writeFile(join(repositoryRoot, 'tracked.txt'), 'tracked source');
  execFileSync('git', ['init', '--quiet'], { cwd: repositoryRoot });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: repositoryRoot,
  });
  execFileSync('git', ['config', 'user.name', 'Snapshot Test'], {
    cwd: repositoryRoot,
  });
  execFileSync('git', ['add', 'tracked.txt'], { cwd: repositoryRoot });
  execFileSync('git', ['commit', '--quiet', '-m', 'tracked source'], {
    cwd: repositoryRoot,
  });
  return directory;
}

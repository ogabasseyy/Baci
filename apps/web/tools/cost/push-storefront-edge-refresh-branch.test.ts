import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const script = join(
  dirname(fileURLToPath(import.meta.url)),
  'push-storefront-edge-refresh-branch.sh'
);
const INVENTORY = 'docs/inventory.json';
const TEST = 'apps/snapshot.test.ts';
const BRANCH = 'automation/storefront-edge-inventory-0123456789ab-cdef01234567';
const gitEnv = {
  ...process.env,
  GIT_CONFIG_COUNT: '4',
  GIT_CONFIG_KEY_0: 'core.hooksPath',
  GIT_CONFIG_VALUE_0: '/dev/null',
  GIT_CONFIG_KEY_1: 'user.name',
  GIT_CONFIG_VALUE_1: 'Refresh Test',
  GIT_CONFIG_KEY_2: 'user.email',
  GIT_CONFIG_VALUE_2: 'refresh@example.invalid',
  GIT_CONFIG_KEY_3: 'commit.gpgsign',
  GIT_CONFIG_VALUE_3: 'false',
};

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

async function git(cwd: string, ...args: string[]) {
  const { stdout } = await execFileAsync('git', args, { cwd, env: gitEnv });
  return stdout.trim();
}

async function writeFiles(cwd: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(cwd, path)), { recursive: true });
    await writeFile(join(cwd, path), content);
  }
}

async function arrange() {
  const root = await mkdtemp(join(tmpdir(), 'edge-refresh-branch-'));
  roots.push(root);
  const remote = join(root, 'remote.git');
  const seed = join(root, 'seed');
  await execFileAsync('git', ['init', '--quiet', '--bare', remote]);
  await mkdir(seed);
  await git(seed, 'init', '--quiet');
  await writeFiles(seed, { [INVENTORY]: 'old\n', [TEST]: 'old\n', x: 'x\n' });
  await git(seed, 'add', '.');
  await git(seed, 'commit', '--quiet', '-m', 'base');
  await git(seed, 'push', '--quiet', remote, 'HEAD:refs/heads/main');
  const sourceSha = await git(seed, 'rev-parse', 'HEAD');
  return { root, remote, seed, sourceSha };
}

/** A fresh shallow checkout of main holding the regenerated files, as in CI. */
async function checkout(fixture: Awaited<ReturnType<typeof arrange>>) {
  const work = await mkdtemp(join(fixture.root, 'work-'));
  await git(
    fixture.root,
    'clone',
    '--quiet',
    '--depth=1',
    '--branch',
    'main',
    `file://${fixture.remote}`,
    work
  );
  await writeFiles(work, { [INVENTORY]: 'new\n', [TEST]: 'new\n' });
  return work;
}

async function run(work: string, sourceSha: string) {
  const { stdout } = await execFileAsync(
    'bash',
    [script, BRANCH, sourceSha, INVENTORY, TEST, 'Regenerated from main.'],
    { cwd: work, env: gitEnv }
  );
  return stdout.trim();
}

describe('push-storefront-edge-refresh-branch.sh', { timeout: 60_000 }, () => {
  it('refuses any ref other than an automation refresh branch, so it can never push a tag', async () => {
    const fixture = await arrange();
    const work = await checkout(fixture);

    for (const ref of ['v1-storefront', 'refs/tags/v1-storefront', 'main']) {
      await expect(
        execFileAsync(
          'bash',
          [script, ref, fixture.sourceSha, INVENTORY, TEST],
          { cwd: work, env: gitEnv }
        )
      ).rejects.toThrow('refusing to push unexpected ref name');
    }
    expect(await git(fixture.remote, 'tag', '--list')).toBe('');
  });

  it('pushes one refresh commit on the source SHA when the branch is new', async () => {
    const fixture = await arrange();
    const work = await checkout(fixture);

    await expect(run(work, fixture.sourceSha)).resolves.toBe('pushed');

    const head = await git(fixture.remote, 'rev-parse', BRANCH);
    expect(await git(fixture.remote, 'rev-parse', `${head}^`)).toBe(
      fixture.sourceSha
    );
    expect(
      await git(fixture.remote, 'diff', '--name-only', fixture.sourceSha, head)
    ).toBe([TEST, INVENTORY].sort().join('\n'));
  });

  it('reuses the already-pushed branch when a rerun retries PR creation', async () => {
    const fixture = await arrange();
    await run(await checkout(fixture), fixture.sourceSha);
    const firstHead = await git(fixture.remote, 'rev-parse', BRANCH);

    // The rerun commits at a different time, so pushing again would be
    // rejected as non-fast-forward and the draft PR would never be created.
    await expect(run(await checkout(fixture), fixture.sourceSha)).resolves.toBe(
      'reused'
    );
    expect(await git(fixture.remote, 'rev-parse', BRANCH)).toBe(firstHead);
  });

  it('refuses to reuse a branch that carries other changes', async () => {
    const fixture = await arrange();
    await run(await checkout(fixture), fixture.sourceSha);
    await git(fixture.seed, 'fetch', '--quiet', fixture.remote, BRANCH);
    await git(fixture.seed, 'switch', '--quiet', '--detach', 'FETCH_HEAD');
    await writeFiles(fixture.seed, { x: 'tampered\n' });
    await git(fixture.seed, 'commit', '--quiet', '-am', 'tamper');
    await git(
      fixture.seed,
      'push',
      '--quiet',
      '--force',
      fixture.remote,
      `HEAD:refs/heads/${BRANCH}`
    );

    await expect(
      run(await checkout(fixture), fixture.sourceSha)
    ).rejects.toThrow('refusing to reuse');
  });

  it('refuses to create the branch when the checkout is not at the source SHA', async () => {
    const fixture = await arrange();
    const work = await checkout(fixture);
    await writeFiles(work, { x: 'local drift\n' });
    await git(work, 'commit', '--quiet', '-am', 'stale checkout');

    await expect(run(work, fixture.sourceSha)).rejects.toThrow(
      'checkout is not at source SHA'
    );
    await expect(
      git(fixture.remote, 'rev-parse', '--verify', '--quiet', BRANCH)
    ).rejects.toThrow();
  });

  it('refuses to reuse a branch whose refresh content differs', async () => {
    const fixture = await arrange();
    await run(await checkout(fixture), fixture.sourceSha);
    const work = await checkout(fixture);
    await writeFiles(work, { [INVENTORY]: 'newer\n' });

    await expect(run(work, fixture.sourceSha)).rejects.toThrow(
      'refusing to reuse'
    );
  });
});

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createContainedEvidenceDependencyWorkspace } from './cloudflare-evidence-contained-dependency-workspace';

const execFileAsync = promisify(execFile);
const PACKAGE_NAMES = ['zod', 'tsx', 'esbuild'] as const;
let fixtureRoot: string | undefined;
let cloneCleanup: (() => Promise<void>) | undefined;

afterEach(async () => {
  await cloneCleanup?.();
  cloneCleanup = undefined;
  if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = undefined;
});

async function git(root: string, args: string[]) {
  const result = await execFileAsync('git', ['-C', root, ...args], {
    encoding: 'utf8',
  });
  return result.stdout.trim();
}

async function createFixtureCaller() {
  fixtureRoot = await mkdtemp(
    join(await realpath(tmpdir()), 'baci-clone-test-')
  );
  const caller = join(fixtureRoot, 'caller');
  await mkdir(caller);
  await writeFile(join(caller, '.gitignore'), 'node_modules/\n');
  await writeFile(join(caller, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  await writeFile(join(caller, 'tracked.txt'), 'fixture caller\n');
  await execFileAsync('git', ['-C', caller, 'init', '--quiet']);
  await execFileAsync('git', ['-C', caller, 'add', '--', '.']);
  await execFileAsync('git', [
    '-C',
    caller,
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgsign=false',
    '-c',
    'user.email=baci-test@example.invalid',
    '-c',
    'user.name=Baci Fixture Test',
    'commit',
    '--quiet',
    '-m',
    'fixture caller base',
  ]);

  for (const packageName of PACKAGE_NAMES) {
    const packageRoot = join(caller, 'node_modules', packageName);
    await mkdir(packageRoot, { recursive: true });
    await writeFile(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: packageName, version: '1.0.0' })
    );
    await writeFile(join(packageRoot, 'index.js'), `${packageName} fixture\n`);
  }
  await mkdir(join(caller, 'node_modules', 'tsx', 'dist'), {
    recursive: true,
  });
  await writeFile(
    join(caller, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    '#!/usr/bin/env node\n'
  );
  return caller;
}

async function callerMetadata(caller: string) {
  const head = await git(caller, ['rev-parse', '--verify', 'HEAD']);
  const indexPath = resolve(
    caller,
    await git(caller, ['rev-parse', '--git-path', 'index'])
  );
  const refs = await git(caller, [
    'for-each-ref',
    '--format=%(refname) %(objectname)',
  ]);
  const status = await git(caller, [
    'status',
    '--porcelain',
    '--untracked-files=all',
  ]);
  const indexSha256 = createHash('sha256')
    .update(await readFile(indexPath))
    .digest('hex');
  return { head, indexPath, indexSha256, refs, status };
}

describe('createContainedEvidenceDependencyWorkspace', () => {
  it('rejects package traversal before copying a caller sibling directory', async () => {
    const caller = await createFixtureCaller();
    const privateFixture = join(caller, 'private');
    await mkdir(privateFixture);
    await writeFile(join(privateFixture, 'dummy.txt'), 'dummy fixture only\n');

    const outcome = await createContainedEvidenceDependencyWorkspace(caller, [
      '../private',
    ]).then(
      (workspace) => ({ workspace }),
      (error: unknown) => ({ error })
    );
    if ('workspace' in outcome) {
      const escapedFixture = await readFile(
        join(outcome.workspace.root, 'private', 'dummy.txt'),
        'utf8'
      );
      await outcome.workspace.cleanup();
      expect(escapedFixture).toBe('dummy fixture only\n');
      expect.fail('accepted ../private as a dependency package name');
    }
    expect(outcome.error).toMatchObject({
      message: 'dependency fixture package name is invalid',
    });
    await expect(
      readFile(join(privateFixture, 'dummy.txt'), 'utf8')
    ).resolves.toBe('dummy fixture only\n');
  });

  it('isolates clone Git metadata, contains copied dependencies, and cleans up', async () => {
    const caller = await createFixtureCaller();
    const callerBefore = await callerMetadata(caller);
    const callerGitDirectory = await git(caller, [
      'rev-parse',
      '--absolute-git-dir',
    ]);
    const clone = await createContainedEvidenceDependencyWorkspace(
      caller,
      PACKAGE_NAMES
    );
    cloneCleanup = clone.cleanup;

    const cloneGitDirectory = await git(clone.root, [
      'rev-parse',
      '--absolute-git-dir',
    ]);
    expect(await realpath(clone.root)).not.toBe(await realpath(caller));
    expect(cloneGitDirectory).not.toBe(callerGitDirectory);
    expect((await lstat(cloneGitDirectory)).isDirectory()).toBe(true);
    expect(await git(clone.root, ['rev-parse', '--verify', 'HEAD'])).toBe(
      callerBefore.head
    );
    expect(
      await git(clone.root, ['status', '--porcelain', '--untracked-files=all'])
    ).toBe('');

    for (const packageName of PACKAGE_NAMES) {
      const copiedPackage = join(clone.root, 'node_modules', packageName);
      expect((await lstat(copiedPackage)).isSymbolicLink()).toBe(false);
      const canonicalPackage = await realpath(copiedPackage);
      const relativePackage = relative(clone.root, canonicalPackage);
      expect(relativePackage).not.toBe('');
      expect(relativePackage).not.toBe('..');
      expect(relativePackage.startsWith(`..${sep}`)).toBe(false);
      expect(isAbsolute(relativePackage)).toBe(false);
      expect(canonicalPackage).not.toBe(
        await realpath(join(caller, 'node_modules', packageName))
      );
      await expect(
        readFile(join(copiedPackage, 'index.js'), 'utf8')
      ).resolves.toBe(`${packageName} fixture\n`);
    }
    const copiedTsxLauncher = join(clone.root, 'node_modules', '.bin', 'tsx');
    expect((await lstat(copiedTsxLauncher)).isSymbolicLink()).toBe(true);
    expect(await realpath(copiedTsxLauncher)).toBe(
      join(clone.root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    );

    const cloneIndexPath = resolve(
      clone.root,
      await git(clone.root, ['rev-parse', '--git-path', 'index'])
    );
    const cloneIndexBefore = createHash('sha256')
      .update(await readFile(cloneIndexPath))
      .digest('hex');
    await writeFile(join(clone.root, 'clone-only.txt'), 'isolated\n');
    await execFileAsync('git', [
      '-C',
      clone.root,
      'add',
      '--',
      'clone-only.txt',
    ]);
    const cloneIndexAfterAdd = createHash('sha256')
      .update(await readFile(cloneIndexPath))
      .digest('hex');
    expect(cloneIndexAfterAdd).not.toBe(cloneIndexBefore);
    await execFileAsync('git', [
      '-C',
      clone.root,
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.email=baci-test@example.invalid',
      '-c',
      'user.name=Baci Fixture Test',
      'commit',
      '--quiet',
      '-m',
      'clone only metadata mutation',
    ]);
    expect(await git(clone.root, ['rev-parse', '--verify', 'HEAD'])).not.toBe(
      callerBefore.head
    );
    await execFileAsync('git', ['-C', clone.root, 'branch', 'clone-only-ref']);
    expect(
      await git(clone.root, [
        'for-each-ref',
        '--format=%(refname) %(objectname)',
      ])
    ).not.toBe(callerBefore.refs);

    expect(await callerMetadata(caller)).toEqual(callerBefore);
    await clone.cleanup();
    cloneCleanup = undefined;
    await expect(access(clone.root)).rejects.toThrow();
  });
});

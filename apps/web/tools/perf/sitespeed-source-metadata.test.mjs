import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { gitMetadata } from './sitespeed-source-metadata.mjs';

const exec = promisify(execFile);
it('hashes relevant untracked source bytes so resume cannot reuse changed source', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'sitespeed-meta-'));
  try {
    await exec('git', ['init', '-q'], { cwd });
    await exec(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '--allow-empty',
        '-qm',
        'fixture',
      ],
      { cwd }
    );
    await mkdir(join(cwd, 'apps/web/tools/perf'), { recursive: true });
    const file = join(cwd, 'apps/web/tools/perf/fixture with spaces.mjs');
    await writeFile(file, 'one');
    const first = await gitMetadata(cwd);
    expect((await gitMetadata(join(cwd, 'apps/web'))).diffHash).toBe(
      first.diffHash
    );
    await writeFile(file, 'two');
    const second = await gitMetadata(cwd);
    expect(first.diffHash).not.toBe(second.diffHash);
    expect(first.dirty).toBe(true);
    for (const directory of [
      'output',
      'apps/web/output',
      'apps/web/.playwright-cli',
    ]) {
      await mkdir(join(cwd, directory), { recursive: true });
      await writeFile(join(cwd, directory, 'result.json'), 'generated');
    }
    expect(await gitMetadata(cwd)).toEqual(second);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

it('includes untracked public asset bytes in the source identity', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'sitespeed-public-meta-'));
  try {
    await exec('git', ['init', '-q'], { cwd });
    await exec(
      'git',
      [
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'user.name=test',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '--allow-empty',
        '-qm',
        'initial',
      ],
      { cwd }
    );
    const publicDir = join(cwd, 'apps/web/public');
    await mkdir(publicDir, { recursive: true });
    const asset = join(publicDir, 'perf-fixture.txt');
    await writeFile(asset, 'asset-one');
    const first = await gitMetadata(cwd);
    await writeFile(asset, 'asset-two');
    const second = await gitMetadata(cwd);
    expect(first.diffHash).not.toBe(second.diffHash);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

it('hashes a tracked diff larger than one MiB without truncating identity', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'sitespeed-large-diff-'));
  try {
    await exec('git', ['init', '-q'], { cwd });
    await exec(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'user.name=test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-qm',
        'initial',
      ],
      { cwd }
    );
    await mkdir(join(cwd, 'apps/web/public'), { recursive: true });
    const file = join(cwd, 'apps/web/public/large-fixture.txt');
    await writeFile(file, 'a'.repeat(1_100_000));
    await exec('git', [
      '-C',
      cwd,
      'add',
      '--',
      'apps/web/public/large-fixture.txt',
    ]);
    await exec('git', [
      '-C',
      cwd,
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'user.name=test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'large',
    ]);
    await writeFile(file, 'b'.repeat(1_100_000));
    const first = await gitMetadata(cwd);
    await writeFile(file, 'c'.repeat(1_100_000));
    expect((await gitMetadata(cwd)).diffHash).not.toBe(first.diffHash);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

it('hashes distinct tracked binary edits with binary-safe git diff', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'sitespeed-binary-meta-'));
  try {
    await exec('git', ['init', '-q'], { cwd });
    await exec(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'user.name=test',
        'commit',
        '--allow-empty',
        '-qm',
        'initial',
      ],
      { cwd }
    );
    const publicDir = join(cwd, 'apps/web/public');
    await mkdir(publicDir, { recursive: true });
    const asset = join(publicDir, 'binary-fixture.bin');
    writeFileSync(asset, Buffer.from([0, 255, 1, 254]));
    await exec('git', [
      '-C',
      cwd,
      'add',
      '--',
      'apps/web/public/binary-fixture.bin',
    ]);
    await exec('git', [
      '-C',
      cwd,
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'user.name=test',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-qm',
      'asset',
    ]);
    writeFileSync(asset, Buffer.from([0, 255, 2, 253]));
    const first = await gitMetadata(cwd);
    writeFileSync(asset, Buffer.from([0, 254, 2, 253]));
    const second = await gitMetadata(cwd);
    expect(first.diffHash).not.toBe(second.diffHash);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

it('includes package, lockfile, and Next config edits in source identity', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'sitespeed-config-meta-'));
  try {
    await exec('git', ['init', '-q'], { cwd });
    await exec(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'user.name=test',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        'commit',
        '--allow-empty',
        '-qm',
        'initial',
      ],
      { cwd }
    );
    await mkdir(join(cwd, 'apps/web'), { recursive: true });
    for (const file of [
      'package.json',
      'apps/web/next.config.ts',
      'pnpm-lock.yaml',
    ]) {
      const target = join(cwd, file);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, 'one');
    }
    await exec('git', [
      '-C',
      cwd,
      'add',
      '--',
      'package.json',
      'apps/web/next.config.ts',
      'pnpm-lock.yaml',
    ]);
    await exec('git', [
      '-C',
      cwd,
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'user.email=test@example.invalid',
      '-c',
      'user.name=test',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-qm',
      'config',
    ]);
    const hashes = [];
    for (const file of [
      'package.json',
      'apps/web/next.config.ts',
      'pnpm-lock.yaml',
    ]) {
      await writeFile(join(cwd, file), 'two');
      hashes.push((await gitMetadata(cwd)).diffHash);
      await writeFile(join(cwd, file), 'one');
    }
    expect(new Set(hashes).size).toBe(3);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

describe('git metadata', () => {
  it('returns stable shape', async () => {
    const metadata = await gitMetadata(process.cwd());
    expect(metadata).toEqual(
      expect.objectContaining({
        sha: expect.any(String),
        dirty: expect.any(Boolean),
        diffHash: expect.any(String),
      })
    );
  });
});

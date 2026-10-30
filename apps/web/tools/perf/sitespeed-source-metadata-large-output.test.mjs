import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';
import { gitMetadata } from './sitespeed-source-metadata.mjs';

const exec = promisify(execFile);
const TEST_MAX_BUFFER = 2 * 1024 * 1024;
const RELEVANT_PATHS = [
  '.',
  ':(exclude,glob)**/output/**',
  ':(exclude,glob)**/.playwright-cli/**',
];

it('reads status and untracked paths beyond one MiB while hashing untracked bytes', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'sitespeed-large-status-'));
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

    const firstDir = 'a'.repeat(120);
    const secondDir = 'b'.repeat(120);
    const root = join(cwd, firstDir, secondDir);
    await mkdir(root, { recursive: true });
    let binaryFile;
    for (let index = 0; index < 2500; index += 1) {
      const suffix = String(index).padStart(4, '0');
      const filename = `${'s'.repeat(210)}-${suffix}.txt`;
      const target = join(root, filename);
      await writeFile(target, '');
      if (index === 0) binaryFile = target;
    }
    await writeFile(binaryFile, Buffer.from([0, 255, 1, 254]));

    const status = await exec(
      'git',
      [
        '-C',
        cwd,
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        ...RELEVANT_PATHS,
      ],
      { maxBuffer: TEST_MAX_BUFFER }
    );
    const untracked = await exec(
      'git',
      [
        '-C',
        cwd,
        'ls-files',
        '--others',
        '--exclude-standard',
        '-z',
        '--',
        ...RELEVANT_PATHS,
      ],
      { encoding: 'buffer', maxBuffer: TEST_MAX_BUFFER }
    );
    expect(Buffer.byteLength(status.stdout)).toBeGreaterThan(1024 * 1024);
    expect(untracked.stdout.length).toBeGreaterThan(1024 * 1024);

    const first = await gitMetadata(cwd);
    expect(first.dirty).toBe(true);

    await writeFile(binaryFile, Buffer.from([0, 255, 2, 253]));
    const second = await gitMetadata(cwd);
    expect(second.dirty).toBe(true);
    expect(second.diffHash).not.toBe(first.diffHash);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 120_000);

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  lstat,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import {
  installDockerStub,
  installStatStub,
} from './running-container-fixture.mjs';

const execFileAsync = promisify(execFile);

test('stat stub emits one per-path record with file types and lstat behavior', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-running-fixture-stat-'));
  const stat = join(directory, 'stat');
  const file = join(directory, 'file');
  const folder = join(directory, 'folder');
  const link = join(directory, 'link');
  try {
    await installStatStub(stat);
    await writeFile(file, 'abc');
    await mkdir(folder);
    await symlink(file, link);
    const fileStats = await lstat(file);
    const folderStats = await lstat(folder);
    const linkStats = await lstat(link);
    const result = await execFileAsync(process.execPath, [
      stat,
      '-c',
      '%f:%F:%s',
      file,
      folder,
      link,
    ]);
    assert.deepEqual(result.stdout.trim().split('\n'), [
      `${(fileStats.mode & 0xffff).toString(16).padStart(4, '0')}:regular file:3`,
      `${(folderStats.mode & 0xffff).toString(16).padStart(4, '0')}:directory:${folderStats.size}`,
      `${(linkStats.mode & 0xffff).toString(16).padStart(4, '0')}:symbolic link:${linkStats.size}`,
    ]);
    const followed = await execFileAsync(process.execPath, [
      stat,
      '-Lc',
      '%f:%F:%s',
      link,
    ]);
    assert.equal(followed.stdout.trim(), '81a4:regular file:3');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('docker stub executes the extracted fixture function', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'baci-running-fixture-docker-')
  );
  const bin = join(directory, 'bin');
  try {
    await mkdir(bin);
    await installDockerStub(bin, 'docker() { printf \'%s\\n\' "$*"; }');
    const result = await execFileAsync(
      join(bin, 'docker'),
      ['inspect', 'fixture'],
      {
        env: { ...process.env, RETIRE_OLLAMA_TMPDIR: directory },
      }
    );
    assert.equal(result.stdout, 'inspect fixture\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

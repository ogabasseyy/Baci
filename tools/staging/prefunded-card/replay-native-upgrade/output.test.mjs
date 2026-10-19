import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { publishPrivateArtifact } from './output.mjs';

async function fixture(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'replay-output-synthetic-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = path.join(directory, 'canonical');
  const receiver = path.join(directory, 'receiver');
  await mkdir(repository);
  await mkdir(receiver);
  return { directory, repository, receiver, destination: path.join(directory, 'new-private') };
}

test('publishes fresh output and content-addressed captures privately outside source trees', async (context) => {
  const value = await fixture(context);
  const files = new Map([['bundle.mjs', Buffer.from('synthetic')],
    ['captures/' + 'a'.repeat(64) + '.source', Buffer.from('fixture')]]);
  await publishPrivateArtifact({ ...value, files });
  assert.equal((await stat(value.destination)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(value.destination, 'captures'))).mode & 0o777, 0o700);
  for (const [name, bytes] of files) {
    assert.deepEqual(await readFile(path.join(value.destination, name)), bytes);
    assert.equal((await stat(path.join(value.destination, name))).mode & 0o777, 0o600);
  }
});

test('refuses existing output, repository/receiver output and symlink aliases without touching them', async (context) => {
  const value = await fixture(context);
  await mkdir(value.destination);
  await writeFile(path.join(value.destination, 'preserve'), 'untouched');
  const link = path.join(value.directory, 'canonical-link');
  await symlink(value.repository, link);
  for (const destination of [value.destination, path.join(value.repository, 'output'),
    path.join(value.receiver, 'output'), path.join(link, 'output')]) {
    await assert.rejects(publishPrivateArtifact({ ...value, destination,
      files: new Map([['bundle.mjs', Buffer.from('fixture')]]) }));
  }
  assert.equal(await readFile(path.join(value.destination, 'preserve'), 'utf8'), 'untouched');
});

test('refuses unsafe artifact paths and cleans only its own new directory on failure', async (context) => {
  const value = await fixture(context);
  for (const name of ['../escape', '/absolute', 'captures/nested/escape']) {
    await assert.rejects(publishPrivateArtifact({ ...value,
      files: new Map([[name, Buffer.from('fixture')]]) }), /Artifact path/);
  }
  await assert.rejects(stat(value.destination), { code: 'ENOENT' });
  await assert.rejects(publishPrivateArtifact({ ...value, files: new Map([
    ['captures', Buffer.from('conflict')], ['captures/' + 'a'.repeat(64) + '.source', Buffer.from('fixture')],
  ]) }));
  await assert.rejects(stat(value.destination), { code: 'ENOENT' });
});

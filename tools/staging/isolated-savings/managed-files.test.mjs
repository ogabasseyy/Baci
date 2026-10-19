import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertManagedFile,
  assertManagedRuntime,
  assertManagedSocket,
  readManagedFile,
  secureManagedSocket,
} from './managed-files.mjs';

test('only fixed root-owned nonwritable regular binding/evidence files are eligible', async () => {
  const info = { isFile: () => true, uid: 0, mode: 0o440, nlink: 1, size: 100 };
  assert.doesNotThrow(() => assertManagedFile(info));
  for (const change of [
    { uid: 1000 },
    { mode: 0o640 },
    { mode: 0o444 },
    { nlink: 2 },
    { size: 262145 },
    { isFile: () => false },
  ])
    assert.throws(() => assertManagedFile({ ...info, ...change }));
  await assert.rejects(readManagedFile('/tmp/unreviewed-binding.json'));
});

test('socket publication requires dedicated-user ownership and nonwritable group directory', () => {
  const directory = {
    isDirectory: () => true,
    uid: 1001,
    gid: 1002,
    mode: 0o750,
  };
  const socket = { isSocket: () => true, uid: 1001, gid: 1002, mode: 0o660 };
  assert.doesNotThrow(() => assertManagedRuntime(directory, 1001, 1002));
  assert.doesNotThrow(() => assertManagedSocket(socket, 1001, 1002));
  for (const mode of [0o777, 0o775, 0o755, 0o700])
    assert.throws(() =>
      assertManagedRuntime({ ...directory, mode }, 1001, 1002)
    );
  for (const change of [
    { uid: 2000 },
    { gid: 2000 },
    { mode: 0o777 },
    { isSocket: () => false },
  ])
    assert.throws(() =>
      assertManagedSocket({ ...socket, ...change }, 1001, 1002)
    );
});

test('nginx-created 0666 socket is restricted before readiness; replacement is rejected', async () => {
  const info = {
    isSocket: () => true,
    uid: 1001,
    gid: 1002,
    mode: 0o666,
    dev: 1,
    ino: 2,
  };
  const modes = [];
  const io = {
    chmod: (_path, mode) => {
      modes.push(mode);
    },
    lstat: () => ({ ...info, mode: 0o660 }),
  };
  await secureManagedSocket('/synthetic/socket', info, 1001, 1002, io);
  assert.deepEqual(modes, [0o660]);
  await assert.rejects(
    secureManagedSocket(
      '/synthetic/socket',
      { ...info, uid: 2000 },
      1001,
      1002,
      io
    )
  );
  assert.equal(modes.length, 1);
  await assert.rejects(
    secureManagedSocket('/synthetic/socket', info, 1001, 1002, {
      ...io,
      lstat: () => ({ ...info, mode: 0o660, ino: 3 }),
    })
  );
});

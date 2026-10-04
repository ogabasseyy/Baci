import { constants } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { readProtectedReplayFile } from './replay-protected-file';

function facts(overrides = {}) {
  return {
    uid: 0,
    mode: 0o400,
    nlink: 1,
    size: 2,
    dev: 1,
    ino: 1,
    mtimeMs: 10,
    ctimeMs: 10,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false,
    ...overrides,
  };
}

function fixture() {
  const handle = {
    stat: vi.fn(async () => facts()),
    readFile: vi.fn(async () => Buffer.from('{}')),
    close: vi.fn(async () => undefined),
  };
  const dependencies = {
    inspect: vi.fn(async (_path: string) =>
      facts({ mode: 0o755, isDirectory: () => true })
    ),
    open: vi.fn(async () => handle),
  };
  const input = {
    path: '/run/pvb-replay/prefunded.json',
    maximumBytes: 1024,
    allowedModes: [0o400, 0o440, 0o600],
  };
  return { input, dependencies, handle };
}

it('opens a root-protected regular file without following its final symlink', async () => {
  const sample = fixture();
  await expect(readProtectedReplayFile(sample.input, sample.dependencies))
    .resolves.toEqual(Buffer.from('{}'));
  expect(sample.dependencies.inspect.mock.calls.map(([path]) => path)).toEqual([
    '/run/pvb-replay', '/run', '/',
  ]);
  expect(sample.dependencies.open).toHaveBeenCalledExactlyOnceWith(
    sample.input.path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
  );
  expect(sample.handle.close).toHaveBeenCalledTimes(1);
});

it.each([
  { uid: 1000 },
  { mode: 0o777 },
  { isSymbolicLink: () => true },
  { isDirectory: () => false },
])('rejects unsafe ancestor metadata before opening: %j', async (override) => {
  const sample = fixture();
  sample.dependencies.inspect.mockResolvedValue(facts({
    mode: 0o755, isDirectory: () => true, ...override,
  }));
  await expect(readProtectedReplayFile(sample.input, sample.dependencies))
    .rejects.toThrow('Staging replay protected file unavailable');
  expect(sample.dependencies.open).not.toHaveBeenCalled();
});

it.each([
  { uid: 1000 },
  { mode: 0o644 },
  { mode: 0o4600 },
  { nlink: 2 },
  { size: 0 },
  { size: 1025 },
  { isFile: () => false },
])('rejects unsafe file metadata before reading: %j', async (override) => {
  const sample = fixture();
  sample.handle.stat.mockResolvedValue(facts(override));
  await expect(readProtectedReplayFile(sample.input, sample.dependencies))
    .rejects.toThrow('Staging replay protected file unavailable');
  expect(sample.handle.readFile).not.toHaveBeenCalled();
  expect(sample.handle.close).toHaveBeenCalledTimes(1);
});

it.each(['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs', 'uid', 'mode', 'nlink'])(
  'refuses %s changing during the read', async (property) => {
    const sample = fixture();
    sample.handle.stat.mockResolvedValueOnce(facts())
      .mockResolvedValueOnce(facts({ [property]: 99 }));
    await expect(readProtectedReplayFile(sample.input, sample.dependencies))
      .rejects.toThrow('Staging replay protected file unavailable');
    expect(sample.handle.close).toHaveBeenCalledTimes(1);
  }
);

it('refuses short reads and redacts open/read errors', async () => {
  const sample = fixture();
  sample.handle.readFile.mockResolvedValue(Buffer.from('{'));
  await expect(readProtectedReplayFile(sample.input, sample.dependencies))
    .rejects.toThrow('Staging replay protected file unavailable');
  sample.dependencies.open.mockRejectedValue(new Error('secret=private'));
  await expect(readProtectedReplayFile(sample.input, sample.dependencies))
    .rejects.toThrow('Staging replay protected file unavailable');
});

it.each(['relative', '/run/../secret', '/run/secret\0'])(
  'rejects noncanonical paths: %s', async (path) => {
    const sample = fixture();
    await expect(readProtectedReplayFile({ ...sample.input, path }, sample.dependencies))
      .rejects.toThrow('Staging replay protected file unavailable');
    expect(sample.dependencies.inspect).not.toHaveBeenCalled();
  }
);

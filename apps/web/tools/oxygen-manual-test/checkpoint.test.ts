import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { CheckpointStore } from './checkpoint';

const directories: string[] = [];
const state = {
  reference: 'request-fixture',
  phone: '2348000000000',
  newUserToken: 'customer-fixture',
  customerPath: 'new' as const,
  createLocked: true,
  retryAvailable: false,
};
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'oxygen-checkpoint-'));
  directories.push(directory);
  return {
    directory,
    store: new CheckpointStore(directory, 'staging', 'partner'),
  };
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});
it('restores an application in a new store and keeps files private', async () => {
  const { directory, store } = await setup();
  await store.save(state);
  expect(
    await new CheckpointStore(directory, 'staging', 'partner').load()
  ).toEqual(state);
  expect((await stat(join(directory, 'staging.json'))).mode & 0o777).toBe(
    0o600
  );
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
  const stored = await readFile(join(directory, 'staging.json'), 'utf8');
  expect(stored).not.toContain('partner"');
  expect(stored).not.toMatch(/expiresAt|"token"|secret|otp|bvn|nin/);
});
it('fails closed on corruption or the wrong partner and separates environments', async () => {
  const { directory, store } = await setup();
  expect(await store.load()).toBeUndefined();
  await store.save(state);
  await expect(
    new CheckpointStore(directory, 'staging', 'other').load()
  ).rejects.toThrow();
  expect(
    await new CheckpointStore(directory, 'production', 'partner').load()
  ).toBeUndefined();
  await writeFile(join(directory, 'staging.json'), 'broken');
  await expect(store.load()).rejects.toThrow();
});

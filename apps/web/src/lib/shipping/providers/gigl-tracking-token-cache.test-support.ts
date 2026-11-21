import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const roots: string[] = [];
export const now = 1_800_000_000_000;
export const credentials = {
  baseUrl: 'https://example.test',
  email: 'synthetic@example.test',
  password: 'synthetic-password',
};
export const token = {
  token: 'synthetic-token',
  userChannelCode: 'channel',
  customerType: 1,
  expiresAt: now + 60_000,
};

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'gigl-token-cache-'));
  roots.push(root);
  return { root, directory: join(root, 'cache') };
}

export async function cleanupFixtures() {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
}

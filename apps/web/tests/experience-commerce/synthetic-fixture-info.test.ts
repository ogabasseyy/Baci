import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { createSyntheticFixtureInfo } from './synthetic-fixture-info';

it('writes private synthetic metadata once and removes it idempotently', ({
  onTestFinished,
}) => {
  const home = mkdtempSync(join(tmpdir(), 'baci-fixture-home-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  onTestFinished(() => {
    vi.unstubAllEnvs();
    rmSync(home, { recursive: true, force: true });
  });
  const directory = join(home, '.codex', 'tmp');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = `baci-synthetic-${randomUUID()}.json`;
  const path = join(directory, filename);
  const cleanup = createSyntheticFixtureInfo(path, {
    url: 'http://127.0.0.1:12345',
    anonKey: 'synthetic',
  });
  try {
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      url: 'http://127.0.0.1:12345',
      anonKey: 'synthetic',
    });
    expect(() =>
      createSyntheticFixtureInfo(path, { url: 'other', anonKey: 'other' })
    ).toThrow();
  } finally {
    cleanup();
    cleanup();
  }
  expect(existsSync(path)).toBe(false);
  expect(() =>
    createSyntheticFixtureInfo(join(home, filename), { url: 'x', anonKey: 'x' })
  ).toThrow('INVALID_SYNTHETIC_FIXTURE_INFO_PATH');
});

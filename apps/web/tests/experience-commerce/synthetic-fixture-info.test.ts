import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { createSyntheticFixtureInfo } from './synthetic-fixture-info';

it('writes private synthetic metadata once and removes it idempotently', () => {
  const path = `/Users/mac/.codex/tmp/baci-synthetic-${randomUUID()}.json`;
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
    createSyntheticFixtureInfo('/tmp/unowned', { url: 'x', anonKey: 'x' })
  ).toThrow();
});

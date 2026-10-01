import {
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { dockerArgs } from './run-storefront-sitespeed.mjs';
import { validateArtifacts } from './sitespeed-artifacts.mjs';
import { prepareSampleDirectory } from './sitespeed-run-output.mjs';

it('isolates retry evidence without deleting prior or sibling samples', () => {
  const root = mkdtempSync(join(tmpdir(), 'sitespeed-retry-'));
  try {
    const run = { profile: 'mobile', family: 'blog', sample: 1 };
    const first = prepareSampleDirectory(root, run);
    const sibling = prepareSampleDirectory(root, { ...run, sample: 2 });
    writeFileSync(join(first, 'old.har'), '{}');
    writeFileSync(join(sibling, 'keep.har'), '{}');
    const retry = prepareSampleDirectory(root, run);
    expect(retry).not.toBe(first);
    expect(existsSync(join(first, 'old.har'))).toBe(true);
    expect(existsSync(join(sibling, 'keep.har'))).toBe(true);
    expect(() => validateArtifacts(retry)).toThrow();
    expect(dockerArgs({ ...run, output: retry, path: '/' }, root)).toContain(
      `/sitespeed.io/mobile/blog/${retry.split('/').at(-1)}`
    );
    rmSync(first, { recursive: true });
    symlinkSync(sibling, first);
    const swappedRetry = prepareSampleDirectory(root, run);
    expect(swappedRetry).not.toBe(first);
    expect(existsSync(join(sibling, 'keep.har'))).toBe(true);
    expect(() =>
      prepareSampleDirectory(root, { ...run, family: '..' })
    ).toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('normalizes trailing base slashes while preserving route queries', () => {
  const run = {
    profile: 'mobile',
    family: 'blog',
    sample: 1,
    path: '/blog?page=2',
  };
  expect(dockerArgs(run, '/tmp/output', 'http://localhost:3105/')).toEqual(
    dockerArgs(run, '/tmp/output', 'http://localhost:3105')
  );
  expect(dockerArgs(run, '/tmp/output', 'http://localhost:3105/')).toContain(
    'http://localhost:3105/blog?page=2'
  );
});

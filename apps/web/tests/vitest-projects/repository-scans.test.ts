import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EXCLUDE_REPOSITORY_SCANS_ENV,
  REPOSITORY_SCAN_TEST_FILES,
  repositoryScanExcludes,
} from '../../vitest.repository-scans';

const WEB_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = path.join(WEB_ROOT, '../..');

describe('vitest.repository-scans list', () => {
  it.each(
    REPOSITORY_SCAN_TEST_FILES
  )('lists %s as a plain relative path to an existing test file', (file) => {
    // A renamed entry would silently move the scan back into the slow job.
    expect(file).toMatch(/\.test\.ts$/);
    expect(file).not.toMatch(/^(\.{0,2}\/|\/)/);
    expect(statSync(path.join(WEB_ROOT, file)).isFile()).toBe(true);
  });

  it('lists each file once', () => {
    expect(new Set(REPOSITORY_SCAN_TEST_FILES).size).toBe(
      REPOSITORY_SCAN_TEST_FILES.length
    );
  });
});

describe('repositoryScanExcludes', () => {
  it('excludes every scan when the CI variable is "1"', () => {
    expect(
      repositoryScanExcludes({ [EXCLUDE_REPOSITORY_SCANS_ENV]: '1' })
    ).toEqual([...REPOSITORY_SCAN_TEST_FILES]);
  });

  it.each([
    undefined,
    '',
    '0',
    'true',
  ])('keeps every scan when the variable is %s', (value) => {
    expect(
      repositoryScanExcludes({ [EXCLUDE_REPOSITORY_SCANS_ENV]: value })
    ).toEqual([]);
  });
});

describe('CI wiring', () => {
  const workflow = readFileSync(
    path.join(REPO_ROOT, '.github/workflows/ci.yml'),
    'utf8'
  );

  it('runs every listed scan file in the repository scans job', () => {
    const job =
      workflow
        .split('\n  quality-repo-scans:\n')[1]
        ?.split(/\n {2}[a-z-]+:\n/)[0] ?? '';
    expect(job).not.toBe('');
    for (const file of REPOSITORY_SCAN_TEST_FILES) expect(job).toContain(file);
  });

  it('feeds the excludes into the shared test config', () => {
    const source = readFileSync(
      path.join(WEB_ROOT, 'vitest.config.ts'),
      'utf8'
    );
    expect(source).toContain('...repositoryScanExcludes(),');
  });
});

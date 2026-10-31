import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { replaySqlCheckRegistry } from './replay-sql-check-registry';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../../..');
const REGISTRY = 'apps/web/tools/db/replay-registry';
const SUITES = [
  'supabase/tests/alpha.sql',
  'supabase/tests/beta.sql',
  'supabase/migrations/tests/gamma.sql',
  'supabase/tests/alpha_parts.inc.sql',
];
const roots: string[] = [];

/** A throwaway repository root with suite files and a `registry/` folder. */
function repository(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'replay-sql-checks-'));
  roots.push(root);
  for (const [relativePath, body] of Object.entries({
    ...Object.fromEntries(SUITES.map((suite) => [suite, 'SELECT 1;\n'])),
    ...files,
  })) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    writeFileSync(path.join(root, relativePath), body);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('replay SQL-check registry', () => {
  it('lists suites in folder order, then file order', () => {
    const root = repository({
      'registry/20261102090000_b/sql-checks.txt': 'supabase/tests/alpha.sql\n',
      'registry/20261101090000_a/sql-checks.txt':
        'supabase/migrations/tests/gamma.sql\n# runs after gamma on purpose\nsupabase/tests/beta.sql\n',
    });

    expect(replaySqlCheckRegistry.readSuites(root, 'registry')).toEqual([
      'supabase/migrations/tests/gamma.sql',
      'supabase/tests/beta.sql',
      'supabase/tests/alpha.sql',
    ]);
  });

  it.each([
    [
      'an \\ir part',
      'supabase/tests/alpha_parts.inc.sql',
      'an \\ir part; register its entry suite',
    ],
    [
      'a suite outside the test folders',
      'supabase/migrations/20261101090000_a.sql',
      'must be supabase/tests/<name>.sql',
    ],
    [
      'a missing suite',
      'supabase/tests/missing.sql',
      'lists missing file supabase/tests/missing.sql',
    ],
    [
      'a traversal path',
      'supabase/tests/../tests/alpha.sql',
      'must be supabase/tests/<name>.sql',
    ],
  ])('rejects %s', (_case, suite, message) => {
    const root = repository({
      'registry/20261101090000_a/sql-checks.txt': `${suite}\n`,
    });

    expect(() => replaySqlCheckRegistry.readSuites(root, 'registry')).toThrow(
      message
    );
  });

  it('rejects a suite registered twice', () => {
    const root = repository({
      'registry/20261101090000_a/sql-checks.txt': 'supabase/tests/alpha.sql\n',
      'registry/20261101090100_b/sql-checks.txt': 'supabase/tests/alpha.sql\n',
    });

    expect(() => replaySqlCheckRegistry.readSuites(root, 'registry')).toThrow(
      '20261101090100_b/sql-checks.txt:1 lists supabase/tests/alpha.sql again'
    );
  });

  it('rejects a registry path that escapes the repository', () => {
    const root = repository({});

    expect(() =>
      replaySqlCheckRegistry.readSuites(root, '../registry')
    ).toThrow('Unsafe replay repository path');
  });

  it('expands the registry flag in place and keeps explicit checks', () => {
    const root = repository({
      'registry/20261101090000_a/sql-checks.txt':
        'supabase/tests/beta.sql\nsupabase/tests/alpha.sql\n',
    });

    expect(
      replaySqlCheckRegistry.expandArguments(
        [
          '--mode',
          'chronological',
          '--sql-check',
          'supabase/migrations/tests/gamma.sql',
          replaySqlCheckRegistry.flag,
          'registry',
        ],
        root
      )
    ).toEqual([
      '--mode',
      'chronological',
      '--sql-check',
      'supabase/migrations/tests/gamma.sql',
      '--sql-check',
      'supabase/tests/beta.sql',
      '--sql-check',
      'supabase/tests/alpha.sql',
    ]);
  });

  it.each([
    [
      'before',
      [
        '--sql-check',
        'supabase/tests/beta.sql',
        '--sql-check-registry',
        'registry',
      ],
    ],
    [
      'after',
      [
        '--sql-check-registry',
        'registry',
        '--sql-check',
        'supabase/tests/beta.sql',
      ],
    ],
  ])('rejects a registered suite also passed explicitly %s the flag', (_case, argv) => {
    const root = repository({
      'registry/20261101090000_a/sql-checks.txt':
        'supabase/tests/alpha.sql\nsupabase/tests/beta.sql\n',
    });

    expect(() => replaySqlCheckRegistry.expandArguments(argv, root)).toThrow(
      '20261101090000_a/sql-checks.txt:2 lists supabase/tests/beta.sql, which is also passed as an explicit --sql-check'
    );
  });

  it('rejects a second registry flag', () => {
    const root = repository({
      'registry/20261101090000_a/sql-checks.txt': 'supabase/tests/alpha.sql\n',
    });

    expect(() =>
      replaySqlCheckRegistry.expandArguments(
        [
          '--sql-check-registry',
          'registry',
          '--sql-check-registry',
          'registry',
        ],
        root
      )
    ).toThrow('--sql-check-registry may appear once');
  });

  it('resolves every checked-in suite that CI runs', () => {
    const suites = replaySqlCheckRegistry.readSuites(REPOSITORY_ROOT, REGISTRY);

    expect(suites.length).toBeGreaterThanOrEqual(188);
    expect(new Set(suites).size).toBe(suites.length);
  });
});

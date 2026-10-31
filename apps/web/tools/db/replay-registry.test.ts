import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { replayRegistry } from './replay-registry';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const registries: string[] = [];

function registry(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'replay-registry-test-'));
  registries.push(root);
  for (const [relativePath, body] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  return root;
}

afterEach(() => {
  for (const root of registries.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('replay registry discovery', () => {
  it('reads every folder in sorted order without a shared index', () => {
    const directory = registry({
      'README.md': '# guide\n',
      '20261102090000_later/sql-checks.txt': 'supabase/tests/c.sql\n',
      '20261101090000_earlier/sql-checks.txt':
        '# reason for the order\nsupabase/tests/b.sql\nsupabase/tests/a.sql\n',
      '20261101090000_earlier/pending-sources.txt': `${SHA_A} 20261101090000_a.sql\n`,
    });

    expect(
      replayRegistry
        .readList('sql-checks.txt', directory)
        .map(({ location, value }) => [location, value])
    ).toEqual([
      ['20261101090000_earlier/sql-checks.txt:2', 'supabase/tests/b.sql'],
      ['20261101090000_earlier/sql-checks.txt:3', 'supabase/tests/a.sql'],
      ['20261102090000_later/sql-checks.txt:1', 'supabase/tests/c.sql'],
    ]);
  });

  it('picks up a newly added conforming folder', () => {
    const files = {
      '20261101090000_first/pending-sources.txt': `${SHA_A} 20261101090000_first.sql\n`,
    };
    const before = replayRegistry.readSourceRows(
      'pending-sources.txt',
      registry(files)
    );
    const after = replayRegistry.readSourceRows(
      'pending-sources.txt',
      registry({
        ...files,
        '20261103090000_second/pending-sources.txt': `${SHA_B} 20261103090000_second.sql\n${SHA_C} 20261103090100_second_followup.sql\n`,
      })
    );

    expect(before).toEqual([`${SHA_A} 20261101090000_first.sql`]);
    expect(after).toEqual([
      `${SHA_A} 20261101090000_first.sql`,
      `${SHA_B} 20261103090000_second.sql`,
      `${SHA_C} 20261103090100_second_followup.sql`,
    ]);
  });

  it('returns nothing for a list no folder provides', () => {
    const directory = registry({
      '20261101090000_only/sql-checks.txt': 'supabase/tests/a.sql\n',
    });

    expect(
      replayRegistry.readSourceRows('expected-pending-sources.txt', directory)
    ).toEqual([]);
  });

  it.each([
    [
      'a folder without a version prefix',
      'piggyvest_goals/pending-sources.txt',
    ],
    ['a folder with an uppercase slug', '20261101090000_Goals/sql-checks.txt'],
    ['a folder with a short version', '2026110109_goals/sql-checks.txt'],
    ['a stray root file', 'notes.txt'],
  ])('rejects %s instead of skipping it', (_case, relativePath) => {
    const directory = registry({
      '20261101090000_ok/sql-checks.txt': 'supabase/tests/a.sql\n',
      [relativePath]: 'supabase/tests/b.sql\n',
    });

    expect(() => replayRegistry.readList('sql-checks.txt', directory)).toThrow(
      `unexpected entry "${relativePath.split('/')[0]}"`
    );
  });

  it('rejects a misnamed list file even when reading another list', () => {
    const directory = registry({
      '20261101090000_typo/pending-source.txt': `${SHA_A} 20261101090000_a.sql\n`,
      '20261101090000_typo/sql-checks.txt': 'supabase/tests/a.sql\n',
    });

    expect(() => replayRegistry.readList('sql-checks.txt', directory)).toThrow(
      'unexpected entry "20261101090000_typo/pending-source.txt"'
    );
  });

  it('ignores Finder metadata but nothing else', () => {
    const directory = registry({
      '.DS_Store': 'binary',
      '20261101090000_ok/.DS_Store': 'binary',
      '20261101090000_ok/sql-checks.txt': 'supabase/tests/a.sql\n',
    });

    expect(
      replayRegistry
        .readList('sql-checks.txt', directory)
        .map(({ value }) => value)
    ).toEqual(['supabase/tests/a.sql']);
    writeFileSync(path.join(directory, '20261101090000_ok/.hidden.txt'), 'x\n');
    expect(() => replayRegistry.readList('sql-checks.txt', directory)).toThrow(
      'unexpected entry "20261101090000_ok/.hidden.txt"'
    );
  });

  it('rejects an empty folder', () => {
    const directory = registry({
      '20261101090000_ok/sql-checks.txt': 'supabase/tests/a.sql\n',
    });
    mkdirSync(path.join(directory, '20261101090100_empty'));

    expect(() => replayRegistry.readList('sql-checks.txt', directory)).toThrow(
      '"20261101090100_empty" is empty'
    );
  });

  it.each([
    [
      'a blank line',
      'supabase/tests/a.sql\n\nsupabase/tests/b.sql\n',
      ':2 is blank',
    ],
    [
      'surrounding whitespace',
      ' supabase/tests/a.sql\n',
      ':1 has surrounding whitespace',
    ],
    [
      'a CRLF line ending',
      'supabase/tests/a.sql\r\n',
      ':1 has surrounding whitespace',
    ],
    [
      'a missing final newline',
      'supabase/tests/a.sql',
      'must end with a newline',
    ],
    ['only comments', '# nothing yet\n', 'lists no entries'],
  ])('rejects a list with %s', (_case, body, message) => {
    const directory = registry({ '20261101090000_bad/sql-checks.txt': body });

    expect(() => replayRegistry.readList('sql-checks.txt', directory)).toThrow(
      message
    );
  });

  it.each([
    ['a short hash', `${'a'.repeat(63)} 20261101090000_a.sql`],
    ['an uppercase hash', `${'A'.repeat(64)} 20261101090000_a.sql`],
    ['two separating spaces', `${SHA_A}  20261101090000_a.sql`],
    ['a repository path', `${SHA_A} supabase/migrations/20261101090000_a.sql`],
    ['a non-migration name', `${SHA_A} 20261101090000_a.txt`],
  ])('rejects a source row with %s', (_case, row) => {
    const directory = registry({
      '20261101090000_bad/pending-sources.txt': `${row}\n`,
    });

    expect(() =>
      replayRegistry.readSourceRows('pending-sources.txt', directory)
    ).toThrow('20261101090000_bad/pending-sources.txt:1 must be');
  });

  it('rejects a migration registered twice in one list', () => {
    const directory = registry({
      '20261101090000_one/expected-pending-sources.txt': `${SHA_A} 20261101090000_a.sql\n`,
      '20261101090100_two/expected-pending-sources.txt': `${SHA_B} 20261101090000_a.sql\n`,
    });

    expect(() =>
      replayRegistry.readSourceRows('expected-pending-sources.txt', directory)
    ).toThrow(
      '20261101090100_two/expected-pending-sources.txt:1 registers 20261101090000_a.sql again (first at 20261101090000_one/expected-pending-sources.txt:1)'
    );
  });

  it('points every failure at the authoring guide', () => {
    const directory = registry({ 'misnamed/sql-checks.txt': 'x\n' });

    expect(() => replayRegistry.readList('sql-checks.txt', directory)).toThrow(
      /^Replay registry: .*see apps\/web\/tools\/db\/replay-registry\/README\.md/
    );
  });

  it('keeps the checked-in registry well formed', () => {
    expect(() => {
      replayRegistry.readSourceRows('pending-sources.txt');
      replayRegistry.readSourceRows('expected-pending-sources.txt');
      replayRegistry.readList('sql-checks.txt');
    }).not.toThrow();
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseReplayCliArguments } from './parse-replay-cli-arguments';

const BASE = [
  '--mode',
  'chronological',
  '--pending-repair-state',
  'materialized',
];
const roots: string[] = [];

function repository(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'replay-cli-arguments-'));
  roots.push(root);
  for (const [relativePath, body] of Object.entries(files)) {
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

describe('parseReplayCliArguments', () => {
  it('expands the registry into the strict parser in registry order', () => {
    const root = repository({
      'supabase/tests/alpha.sql': 'SELECT 1;\n',
      'supabase/tests/beta.sql': 'SELECT 1;\n',
      'registry/20261101090000_a/sql-checks.txt':
        'supabase/tests/beta.sql\nsupabase/tests/alpha.sql\n',
    });

    expect(
      parseReplayCliArguments(
        [...BASE, '--sql-check-registry', 'registry'],
        root
      )
    ).toMatchObject({
      comparisonMode: 'enforce',
      mode: 'chronological',
      pendingRepairState: 'materialized',
      sqlChecks: ['supabase/tests/beta.sql', 'supabase/tests/alpha.sql'],
    });
  });

  it('keeps explicit --sql-check arguments working without a registry', () => {
    expect(
      parseReplayCliArguments(
        [...BASE, '--sql-check', 'supabase/tests/alpha.sql'],
        repository({})
      ).sqlChecks
    ).toEqual(['supabase/tests/alpha.sql']);
  });

  it('still rejects arguments the strict parser does not allow', () => {
    expect(() =>
      parseReplayCliArguments([...BASE, '--unknown', 'value'], repository({}))
    ).toThrow('Invalid Supabase replay arguments');
  });

  it.each([
    ['a valueless flag', ['--verbose']],
    ['an inline flag', ['--comparison-mode=enforce']],
  ])('expands the registry but still rejects %s', (_case, extra) => {
    const root = repository({
      'supabase/tests/alpha.sql': 'SELECT 1;\n',
      'registry/20261101090000_a/sql-checks.txt': 'supabase/tests/alpha.sql\n',
    });

    expect(() =>
      parseReplayCliArguments(
        [...extra, ...BASE, '--sql-check-registry', 'registry'],
        root
      )
    ).toThrow('Invalid Supabase replay arguments');
  });

  it('fails before the replay starts when the registry is malformed', () => {
    const root = repository({
      'registry/misnamed/sql-checks.txt': 'supabase/tests/alpha.sql\n',
    });

    expect(() =>
      parseReplayCliArguments(
        [...BASE, '--sql-check-registry', 'registry'],
        root
      )
    ).toThrow('Replay registry: unexpected entry "misnamed"');
  });

  it('resolves the checked-in registry from the default repository root', () => {
    const { sqlChecks } = parseReplayCliArguments([
      ...BASE,
      '--sql-check-registry',
      'apps/web/tools/db/replay-registry',
    ]);

    expect(sqlChecks[0]).toBe(
      'supabase/tests/public_definer_function_exposure.sql'
    );
    expect(sqlChecks.length).toBeGreaterThanOrEqual(188);
  });
});

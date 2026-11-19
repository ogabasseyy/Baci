import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'primary-wallet-savings-recovery.integration.sql'
);

function missingIncludes(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('\\ir '))
    .flatMap((line) => {
      const target = path.resolve(path.dirname(file), line.slice(4).trim());
      if (!existsSync(target)) return [path.relative(process.cwd(), target)];
      return missingIncludes(target, seen);
    });
}

// The isolated run below is gated off in CI, so a migration re-stamp that
// left a stale include would otherwise go unnoticed until someone ran it.
it('includes only migrations and fixtures that exist', () => {
  expect(missingIncludes(fixture)).toEqual([]);
});

it.runIf(process.env.BACI_PRIMARY_WALLET_SQL_TESTS === 'true')(
  'recovers pending savings without onboarding gating or writes in isolated PostgreSQL',
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'primary-savings-'));
    const data = path.join(directory, 'data');
    const options = { encoding: 'utf8' as const, timeout: 30000 };
    let started = false;
    try {
      execFileSync(
        'initdb',
        ['-D', data, '-U', 'fixture_owner', '-A', 'trust', '--no-locale'],
        options
      );
      execFileSync(
        'pg_ctl',
        [
          '-D',
          data,
          '-l',
          path.join(directory, 'postgres.log'),
          '-o',
          `-k ${directory} -p 56547 -c listen_addresses=''`,
          '-w',
          'start',
        ],
        options
      );
      started = true;
      const result = execFileSync(
        'psql',
        [
          '-h',
          directory,
          '-p',
          '56547',
          '-U',
          'fixture_owner',
          '-d',
          'postgres',
          '-v',
          'ON_ERROR_STOP=1',
          '-f',
          fixture,
        ],
        options
      );
      expect(result).toContain('DO');
    } finally {
      if (started)
        execFileSync(
          'pg_ctl',
          ['-D', data, '-m', 'immediate', '-w', 'stop'],
          options
        );
      rmSync(directory, { recursive: true, force: true });
    }
  },
  60000
);

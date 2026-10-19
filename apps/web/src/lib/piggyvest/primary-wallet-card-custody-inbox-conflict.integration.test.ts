import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'primary-wallet-card-custody-inbox-conflict.integration.sql'
);

it.runIf(process.env.BACI_PRIMARY_WALLET_SQL_TESTS === 'true')(
  'blocks conflicted custody inbox originals in isolated PostgreSQL',
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
          `-k ${directory} -p 56524 -c listen_addresses=''`,
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
          '56524',
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

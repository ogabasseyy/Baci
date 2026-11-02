import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'storefront-wallet-phone-update.integration.sql'
);

it.runIf(process.env.BACI_PRIMARY_WALLET_SQL_TESTS === 'true')(
  'runs the phone-save replay suite with only its own transaction-local customers',
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'wallet-phone-replay-'));
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
          `-k ${directory} -p 56544 -c listen_addresses=''`,
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
          '56544',
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
      expect(result).toContain('ROLLBACK');
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
  120000
);

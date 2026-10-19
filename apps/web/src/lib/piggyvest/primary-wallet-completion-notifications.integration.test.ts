import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'primary-wallet-completion-notifications.integration.sql'
);

it.runIf(process.env.BACI_PRIMARY_WALLET_SQL_TESTS === 'true')(
  'queues interest-only completion once and voids the notice after reversal',
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'primary-notices-'));
    const dataDirectory = path.join(directory, 'data');
    const options = { encoding: 'utf8' as const, timeout: 15000 };
    let started = false;
    try {
      execFileSync(
        'initdb',
        [
          '-D',
          dataDirectory,
          '-U',
          'notice_owner',
          '-A',
          'trust',
          '--no-locale',
        ],
        options
      );
      execFileSync(
        'pg_ctl',
        [
          '-D',
          dataDirectory,
          '-l',
          path.join(directory, 'postgres.log'),
          '-o',
          `-k ${directory} -p 56484 -c listen_addresses=''`,
          '-w',
          'start',
        ],
        options
      );
      started = true;
      const output = execFileSync(
        'psql',
        [
          '-h',
          directory,
          '-p',
          '56484',
          '-U',
          'notice_owner',
          '-d',
          'postgres',
          '-v',
          'ON_ERROR_STOP=1',
          '-f',
          fixture,
        ],
        options
      );
      expect(output).toContain(
        'PRIMARY completion notification regressions passed'
      );
    } finally {
      try {
        if (started)
          execFileSync(
            'pg_ctl',
            ['-D', dataDirectory, '-m', 'fast', '-w', 'stop'],
            options
          );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  30000
);

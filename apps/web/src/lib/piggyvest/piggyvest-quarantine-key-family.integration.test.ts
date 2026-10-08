import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const baseMigration = path.resolve(
  sourceDirectory,
  '../../../../../supabase/migrations/20260918180000_piggyvest_event_quarantine.sql'
);
const reasonMigration = path.resolve(
  sourceDirectory,
  '../../../../../supabase/migrations/20261008090400_piggyvest_quarantine_key_family_reason.sql'
);

const setupRoles = `
DO $$
BEGIN
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`;

const insertKeyFamily = (digest: string) => `
INSERT INTO public.piggyvest_event_quarantine (body_digest, reason, event_type)
VALUES ('${digest}', 'key-family', 'restriction-created.success');
`;

// Negative control: the original constraint must reject the new reason.
const assertRejectedBeforeMigration = `
DO $$
BEGIN
  ${insertKeyFamily('a'.repeat(64))}
  RAISE EXCEPTION 'key-family reason was accepted before the migration';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
`;

const assertAcceptedAfterMigration = `
${insertKeyFamily('b'.repeat(64))}
DO $$
BEGIN
  INSERT INTO public.piggyvest_event_quarantine (body_digest, reason)
  VALUES ('${'c'.repeat(64)}', 'forged-reason');
  RAISE EXCEPTION 'arbitrary reason was accepted after the migration';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
SELECT 'key-family-accepted' AS marker;
`;

it.runIf(process.env.BACI_PRIMARY_WALLET_SQL_TESTS === 'true')(
  'quarantine accepts the key-family reason only after the 090400 migration',
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'quarantine-key-family-'));
    const dataDirectory = path.join(directory, 'data');
    const options = { encoding: 'utf8' as const, timeout: 15000 };
    let started = false;
    try {
      execFileSync(
        'initdb',
        ['-D', dataDirectory, '-U', 'quarantine_owner', '-A', 'trust', '--no-locale'],
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
          `-k ${directory} -p 56518 -c listen_addresses=''`,
          '-w',
          'start',
        ],
        options
      );
      started = true;
      const connection = [
        '-h',
        directory,
        '-p',
        '56518',
        '-U',
        'quarantine_owner',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
      ];
      execFileSync('psql', [...connection, '-c', setupRoles], options);
      execFileSync('psql', [...connection, '-f', baseMigration], options);
      const pre = execFileSync(
        'psql',
        [...connection, '-c', assertRejectedBeforeMigration],
        options
      );
      expect(pre).toContain('DO');
      execFileSync('psql', [...connection, '-f', reasonMigration], options);
      const post = execFileSync(
        'psql',
        [...connection, '-c', assertAcceptedAfterMigration],
        options
      );
      expect(post).toContain('key-family-accepted');
    } finally {
      try {
        if (started)
          execFileSync(
            'pg_ctl',
            ['-D', dataDirectory, '-m', 'immediate', '-w', 'stop'],
            options
          );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  30000
);

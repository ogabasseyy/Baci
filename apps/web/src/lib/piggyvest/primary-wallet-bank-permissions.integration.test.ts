import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it.runIf(process.env.BACI_PRIMARY_WALLET_SQL_TESTS === 'true').each([
  ['success', undefined],
  ['acl_drift', 'Object identity, owner or ACL changed'],
  ['restricted_consumer', 'Consumer manifest contains a restricted'],
  ['routine_kind_drift', 'Object identity, owner or ACL changed'],
])(
  'repairs PUBLIC grants or rolls back safely for %s',
  (scenario, expectedError) => {
    const directory = mkdtempSync(path.join(tmpdir(), 'primary-permissions-'));
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
          `-k ${directory} -p 56514 -c listen_addresses=''`,
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
        '56514',
        '-U',
        'fixture_owner',
        '-d',
        'postgres',
      ];
      const execute = () =>
        execFileSync(
          'psql',
          [
            ...connection,
            '-v',
            'ON_ERROR_STOP=1',
            ...(scenario === 'success' ? [] : ['-v', `${scenario}=1`]),
            '-f',
            path.join(
              path.dirname(fileURLToPath(import.meta.url)),
              'primary-wallet-bank-permissions.integration.sql'
            ),
          ],
          options
        );
      if (expectedError) {
        expect(execute).toThrow(expectedError);
        const retained = execFileSync(
          'psql',
          [
            ...connection,
            '-tAc',
            "SELECT has_function_privilege('public','public.permission_fixture()','EXECUTE') AND has_table_privilege('public','net.http_request_queue','SELECT') AND has_sequence_privilege('public','net.http_request_queue_id_seq','USAGE') AND NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid='net.http_request_queue'::regclass AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='legacy_permission_consumer'))",
          ],
          options
        );
        expect(retained.trim()).toBe('t');
      } else {
        expect(execute()).toContain('DO');
      }
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

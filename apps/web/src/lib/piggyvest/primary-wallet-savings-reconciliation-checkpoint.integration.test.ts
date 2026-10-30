import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const operationId = '00000000-0000-4000-8000-000000000008';
const integrationId = '00000000-0000-4000-8000-000000000004';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'primary-wallet-savings-reconciliation-checkpoint.integration.sql'
);

it.runIf(process.env.BACI_PRIMARY_WALLET_SQL_TESTS === 'true')(
  'fences advisory savings reconciliation checkpoints in isolated PostgreSQL',
  async () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), 'primary-savings-checkpoint-')
    );
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

      execFileSync(
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
          '-c',
          `DELETE FROM piggyvest_primary.savings_reconciliation_checkpoints WHERE operation_id='${operationId}'`,
        ],
        options
      );
      const proof = JSON.stringify({
        operationId,
        providerTransactionId: 'race-provider-transfer',
        reference: 'pvb-save-00000000-0000-4000-8000-000000000008',
        amountKobo: 2000,
        sourceWalletId: 'wallet',
        destinationWalletId: 'destination',
        businessId: 'fixture-business',
      });
      const settlementSql = `SET SESSION AUTHORIZATION primary_evidence_fixture;
        BEGIN;
        SELECT piggyvest_primary.settle_savings('${integrationId}','staging','${proof}'::jsonb);
        SELECT pg_sleep(3);
        COMMIT;
        RESET SESSION AUTHORIZATION;`;
      const settlement = spawn(
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
          '-c',
          settlementSql,
        ],
        { env: { ...process.env, PGAPPNAME: 'checkpoint-terminal-race' } }
      );
      let settlementOutput = '';
      let settlementError = '';
      settlement.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        settlementOutput += chunk;
      });
      settlement.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        settlementError += chunk;
      });
      const settled = new Promise<void>((resolve, reject) => {
        settlement.once('error', reject);
        settlement.once('close', (code) =>
          code === 0
            ? resolve()
            : reject(
                new Error(
                  `terminal race session failed (${code}): ${settlementError}`
                )
              )
        );
      });
      let sawTerminalTransition = false;
      for (let attempt = 0; attempt < 75; attempt++) {
        const active = execFileSync(
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
            '-At',
            '-c',
            "SELECT count(*) FROM pg_stat_activity WHERE application_name='checkpoint-terminal-race' AND state='active' AND query LIKE '%pg_sleep(3)%'",
          ],
          options
        ).trim();
        if (active === '1') {
          sawTerminalTransition = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      if (!sawTerminalTransition) {
        settlement.kill('SIGTERM');
        await settled.catch(() => undefined);
      }
      expect(sawTerminalTransition).toBe(true);
      const claim = execFileSync(
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
          '-At',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          `SET SESSION AUTHORIZATION primary_evidence_fixture; SELECT piggyvest_primary.claim_savings_reconciliation_checkpoint('${integrationId}','staging','${operationId}'); RESET SESSION AUTHORIZATION;`,
        ],
        options
      );
      expect(claim).toContain('"status": "stale"');
      await settled;
      expect(settlementOutput).toContain('confirmed');
      const remaining = execFileSync(
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
          '-At',
          '-c',
          `SELECT count(*) FROM piggyvest_primary.savings_reconciliation_checkpoints WHERE operation_id='${operationId}'`,
        ],
        options
      ).trim();
      expect(remaining).toBe('0');
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

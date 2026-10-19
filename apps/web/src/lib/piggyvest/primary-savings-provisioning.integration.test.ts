import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { provisionPrimarySavingsWallet } from './primary-savings-provisioning';
import { primarySavingsPostgresFixture } from './primary-savings-provisioning-postgres.test-support';
import { createPrimarySavingsProvisioningStore } from './primary-savings-provisioning-store';

vi.mock('server-only', () => ({}));

const source = path.dirname(fileURLToPath(import.meta.url));
const migrations = path.resolve(source, '../../../../../supabase/migrations');
const { scope, setup, assertions } = primarySavingsPostgresFixture;

it.runIf(process.env.BACI_PRIMARY_WALLET_SQL_TESTS === 'true')(
  'fences provisioning and enrolls only owned provider-ready destinations in isolated PostgreSQL',
  async () => {
    const directory = mkdtempSync(
      path.join(tmpdir(), 'primary-savings-provisioning-')
    );
    const data = path.join(directory, 'data');
    const options = { encoding: 'utf8' as const, timeout: 15000 };
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
          `-k ${directory} -p 56484 -c listen_addresses=''`,
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
        '56484',
        '-U',
        'fixture_owner',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
      ];
      execFileSync(
        'psql',
        [
          ...connection,
          '-f',
          path.join(source, 'primary-wallet-storage.integration.sql'),
        ],
        options
      );
      execFileSync('psql', [...connection, '-c', setup], options);
      execFileSync(
        'psql',
        [
          ...connection,
          '-f',
          path.join(
            migrations,
            '20261007144000_piggyvest_primary_savings_reservations.sql'
          ),
        ],
        options
      );
      execFileSync(
        'psql',
        [
          ...connection,
          '-f',
          path.join(
            migrations,
            '20261007190000_piggyvest_primary_savings_provisioning.sql'
          ),
        ],
        options
      );
      expect(
        execFileSync('psql', [...connection, '-c', assertions], options)
      ).toContain('DO');
      const concurrentClaim = `SET SESSION AUTHORIZATION goal_fixture;
      SELECT piggyvest_primary.prepare_goal_wallet('${scope}','00000000-0000-4000-8000-000000000008',true)->>'status';`;
      const claim = () =>
        new Promise<string>((resolve, reject) => {
          execFile(
            'psql',
            [...connection, '-At', '-c', concurrentClaim],
            options,
            (error, output) =>
              error
                ? reject(error)
                : resolve(output.trim().split('\n').at(-1) ?? '')
          );
        });
      expect((await Promise.all([claim(), claim()])).sort()).toEqual([
        'claimed',
        'pending',
      ]);
      const execute = async (
        statement: string,
        parameters: readonly unknown[]
      ) => {
        const literals = parameters.map((value) =>
          value === null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`
        );
        const sql = statement.replace(
          /\$(\d+)/g,
          (_placeholder, parameterIndex: string) =>
            literals[Number(parameterIndex) - 1]
        );
        const output = execFileSync(
          'psql',
          [
            ...connection,
            '-At',
            '-c',
            `SET SESSION AUTHORIZATION goal_fixture; ${sql}`,
          ],
          options
        );
        const value = output.trim().split('\n').at(-1) ?? 'null';
        return {
          rows: [
            {
              result:
                value === 't'
                  ? true
                  : value === 'f'
                    ? false
                    : JSON.parse(value),
            },
          ],
        };
      };
      const selectedGoal = '00000000-0000-4000-8000-000000000009';
      const walletName = `baci-save:00000000-0000-4000-8000-000000000004:${selectedGoal}`;
      const input = {
        scope: JSON.parse(scope),
        goalId: selectedGoal,
        mode: 'provision' as const,
        interestAccepted: true,
        store: createPrimarySavingsProvisioningStore({
          scope: JSON.parse(scope),
          execute,
        }),
        createWallet: vi
          .fn()
          .mockResolvedValue({ id: 'integrated-destination' }),
        listWallets: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValue([
            {
              id: 'integrated-destination',
              name: walletName,
              status: 'active',
            },
          ]),
        retrieveWallet: vi.fn().mockResolvedValue({
          id: 'integrated-destination',
          name: walletName,
          api_customer_id: 'customer',
          business_id: 'fixture-business',
          currency: 'NGN',
          type: 'api',
          status: 'active',
          balance: 0,
        }),
        retrieveAccounts: vi.fn().mockResolvedValue([
          {
            account_number: '0123456789',
            account_name: 'Synthetic',
            bank_name: 'Synthetic Bank',
          },
        ]),
      };
      const enrolled = await provisionPrimarySavingsWallet(input);
      expect(enrolled.status).toBe('ready');
      expect(enrolled.interestAccepted).toBe(true);
      expect(enrolled.accounts).toEqual([
        {
          accountNumber: '0123456789',
          accountName: 'Synthetic',
          bankName: 'Synthetic Bank',
        },
      ]);
      expect(input.createWallet).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'customer',
          enableInterestAccrual: true,
        })
      );
      expect(
        (
          await provisionPrimarySavingsWallet({
            ...input,
            interestAccepted: false,
          })
        ).status
      ).toBe('conflict');
      expect(input.createWallet).toHaveBeenCalledOnce();
      expect(
        (await provisionPrimarySavingsWallet({ ...input, mode: 'recover' }))
          .status
      ).toBe('ready');
      expect(input.createWallet).toHaveBeenCalledOnce();
    } finally {
      try {
        if (started)
          execFileSync(
            'pg_ctl',
            ['-D', data, '-m', 'immediate', '-w', 'stop'],
            options
          );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  },
  30000
);

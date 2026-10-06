import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPiggyvestCustomerFundingScreen } from './customer-funding-screen';
import { createFundingScreenFixture } from './customer-funding-screen.test-fixture';
import { createPiggyvestPostgresExecutor } from './postgres-executor';

vi.mock('server-only', () => ({}));
afterEach(() => vi.unstubAllGlobals());

describe.skipIf(process.env.PIGGYVEST_RUN_FUNDING_RUNTIME !== '1')(
  'actual restricted funding screen persistence',
  () => {
    it('connects accepted unfunded draft through actual SQL/provenance/mapping and synthetic provider HTTP', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          throw new Error('Ambient fetch prohibited');
        })
      );
      const fixture = createFundingScreenFixture();
      const configuration = {
        environment: 'staging',
        transport: 'local_test',
        socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
        database: 'piggyvest_local',
        password: 'synthetic-local-only',
        port: 55449,
      };
      const execute = createPiggyvestPostgresExecutor({
        ...configuration,
        role: 'piggyvest_staging_policy_writer',
      });
      const mapping = createPiggyvestPostgresExecutor({
        ...configuration,
        role: 'piggyvest_staging_worker',
      });
      const runtime = createPiggyvestCustomerFundingScreen({
        ...fixture.options,
        execute,
        fundingExecute: execute,
        mappingExecute: async (statement, parameters) => {
          const result = await mapping(statement, parameters);
          if (!Array.isArray(result.rows)) throw new Error('Invalid mapping');
          return { rows: result.rows };
        },
      });
      const result = await runtime.readScreen(
        new NextRequest(
          `http://localhost/policy?goalId=${fixture.identity.goalId}`
        )
      );
      expect(result).toMatchObject({
        status: 'ready',
        policy: { consent: 'accepted', durationMonths: 1 },
        eligibility: { status: 'allowed' },
        funding: {
          status: 'ready',
          accounts: [{ accountNumber: '0001234567' }],
        },
        progress: { status: 'unavailable' },
      });
      expect(fixture.fetchImplementation).toHaveBeenCalledTimes(2);
      expect(
        fixture.fetchImplementation.mock.calls.map(([url]) => String(url))
      ).toEqual([
        'https://staging.piggyvest.business/api/v1/wallet/synthetic-wallet',
        'https://staging.piggyvest.business/api/v1/wallet/synthetic-wallet/accounts',
      ]);
      expect(fetch).not.toHaveBeenCalled();
      await expect(execute('SELECT 1', [])).rejects.toThrow(
        'PiggyVest database unavailable'
      );
    });
  }
);

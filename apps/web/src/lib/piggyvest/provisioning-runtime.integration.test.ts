import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { piggyvestPostgresConfigurationSchema } from '@/schemas/piggyvest-postgres-configuration';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { provisionPiggyvestStagingResource } from './provisioning-client';
import { recoverPiggyvestProvisioning } from './provisioning-recovery-client';
import { createPiggyvestProvisioningRecoveryStore } from './provisioning-recovery-store';
import { resolvePiggyvestWalletMapping } from './wallet-mapping';

vi.mock('server-only', () => ({}));

describe.skipIf(process.env.PIGGYVEST_RUN_LOCAL_POSTGRES !== '1')(
  'provisioning with committed local storage',
  () => {
    let admin: Client;
    let execute: ReturnType<typeof createPiggyvestPostgresExecutor>;
    const customerIds = [
      '22222222-2222-4222-8222-222222222221',
      '22222222-2222-4222-8222-222222222222',
      '22222222-2222-4222-8222-222222222223',
    ];
    const configuration = {
      environment: 'staging',
      integrationId: '44444444-4444-4444-8444-444444444444',
      expectedMerchantId: '11111111-1111-4111-8111-111111111111',
      expectedProjectId: 'synthetic-project',
      actualProjectId: 'synthetic-project',
      allowlistedCustomerIds: customerIds,
      provisioningApproved: true,
      syntheticIdentityApproved: true,
      defaultInterestRoutingVerified: true,
      fingerprintKey: 'synthetic-fingerprint-key-at-least-32-bytes',
      apiSecret: 'synthetic-provider-secret',
      expectedBusinessId: 'synthetic-business',
    };
    function command(customerId: string) {
      return {
        merchantId: configuration.expectedMerchantId,
        customerId,
        kind: 'create_customer',
        bvn: '00000000000',
        email: 'synthetic@example.test',
        name: 'Synthetic Customer',
        phone: '+2340000000000',
        enableInterestAccrual: false,
        interestPayout: 'own_wallet',
      };
    }
    function acknowledgement(suffix: string) {
      return Response.json({
        status: true,
        data: {
          customer_id: `synthetic-customer-${suffix}`,
          wallet_id: `synthetic-wallet-${suffix}`,
          new_customer: true,
        },
      });
    }

    beforeAll(async () => {
      const database = piggyvestPostgresConfigurationSchema.parse({
        environment: 'staging',
        transport: 'local_test',
        socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
        database: 'piggyvest_local',
        password: 'synthetic-local-only',
        role: 'piggyvest_staging_provisioner',
        port: 55443,
      });
      if (database.transport !== 'local_test')
        throw new Error('Local fixture required');
      execute = createPiggyvestPostgresExecutor(database);
      admin = new Client({
        host: database.socketDirectory,
        port: database.port,
        database: database.database,
        user: 'harness_admin',
        password: database.password,
        ssl: false,
        options: '-c search_path=pg_catalog -c statement_timeout=2500',
        connectionTimeoutMillis: 1000,
        query_timeout: 3000,
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          throw new Error('External HTTP prohibited');
        })
      );
      await admin.connect();
    });
    afterAll(async () => {
      try {
        expect(globalThis.fetch).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        await admin?.end();
      }
    });

    it('persists the claim before simulated HTTP and retains acknowledgement references', async () => {
      const fetchImplementation = vi.fn(async () => {
        const committed = await admin.query(
          'SELECT status, attempts FROM piggyvest_staging.provisioning_intents WHERE customer_id = $1',
          [customerIds[0]]
        );
        expect(committed.rows).toEqual([{ status: 'dispatched', attempts: 1 }]);
        return acknowledgement('committed');
      });
      const result = await provisionPiggyvestStagingResource({
        configuration,
        command: command(customerIds[0]),
        execute,
        fetchImplementation,
      });
      expect(result.status).toBe('awaiting_confirmation');
      const recoveryConfiguration = {
        storage: {
          environment: 'staging',
          integrationId: configuration.integrationId,
          expectedMerchantId: configuration.expectedMerchantId,
          expectedBusinessId: configuration.expectedBusinessId,
        },
        wallet: {
          apiSecret: configuration.apiSecret,
          expectedBusinessId: configuration.expectedBusinessId,
        },
      };
      const observeWallet = (id: string) =>
        vi.fn(async () =>
          Response.json({
            status: true,
            data: {
              id,
              business_id: configuration.expectedBusinessId,
              currency: 'NGN',
              status: 'active',
            },
          })
        );
      expect(
        await recoverPiggyvestProvisioning({
          configuration: recoveryConfiguration,
          scope: {
            intentId: result.intentId,
            customerId: customerIds[0],
            goalId: null,
          },
          execute,
          fetchImplementation: observeWallet('synthetic-wallet-committed'),
        })
      ).toEqual({ status: 'completed' });
      const goalId = '33333333-3333-4333-8333-333333333333';
      const plan = await provisionPiggyvestStagingResource({
        configuration,
        execute,
        command: {
          kind: 'create_plan_wallet',
          merchantId: configuration.expectedMerchantId,
          customerId: customerIds[0],
          goalId,
          providerCustomerId: 'synthetic-customer-committed',
          reserveVirtualAccount: true,
          enableInterestAccrual: true,
          interestPayout: 'own_wallet',
        },
        fetchImplementation: vi.fn(async () =>
          Response.json({ status: true, data: { id: 'synthetic-plan-wallet' } })
        ),
      });
      expect(plan.status).toBe('awaiting_confirmation');
      const scope = {
        intentId: plan.intentId,
        customerId: customerIds[0],
        goalId,
      };
      expect(
        await recoverPiggyvestProvisioning({
          configuration: recoveryConfiguration,
          scope,
          execute,
          fetchImplementation: observeWallet('synthetic-plan-wallet'),
        })
      ).toEqual({ status: 'completed' });
      const noRepeat = vi.fn();
      expect(
        await recoverPiggyvestProvisioning({
          configuration: recoveryConfiguration,
          scope,
          execute,
          fetchImplementation: noRepeat,
        })
      ).toEqual({ status: 'completed' });
      expect(noRepeat).not.toHaveBeenCalled();
      expect(
        await resolvePiggyvestWalletMapping({
          configuration: {
            environment: 'staging',
            integrationId: configuration.integrationId,
            expectedMerchantId: configuration.expectedMerchantId,
          },
          input: {
            providerWalletId: 'synthetic-plan-wallet',
            providerCustomerId: 'synthetic-customer-committed',
          },
          execute,
        })
      ).toEqual({
        merchantId: configuration.expectedMerchantId,
        customerId: customerIds[0],
        goalId,
      });
      const recoveryStore = createPiggyvestProvisioningRecoveryStore({
        configuration: {
          environment: 'staging',
          integrationId: configuration.integrationId,
          expectedMerchantId: configuration.expectedMerchantId,
          expectedBusinessId: configuration.expectedBusinessId,
        },
        execute,
      });
      await expect(
        recoveryStore.readCustomerMapping(customerIds[0])
      ).resolves.toEqual({
        outcome: 'mapped',
        provider_customer_id: 'synthetic-customer-committed',
      });
      await expect(
        recoveryStore.readCustomerMapping(customerIds[1])
      ).resolves.toEqual({ outcome: 'none', provider_customer_id: null });
      await expect(
        execute(
          'SELECT outcome, provider_customer_id FROM piggyvest_staging.read_customer_mapping($1::uuid, $2::uuid, $3::uuid, $4::text)',
          [
            configuration.integrationId,
            '11111111-1111-4111-8111-111111111112',
            customerIds[0],
            configuration.expectedBusinessId,
          ]
        )
      ).resolves.toEqual({
        rows: [{ outcome: 'none', provider_customer_id: null }],
      });
      await expect(
        execute(
          'SELECT outcome, provider_customer_id FROM piggyvest_staging.read_customer_mapping($1::uuid, $2::uuid, $3::uuid, $4::text)',
          [
            configuration.integrationId,
            configuration.expectedMerchantId,
            customerIds[0],
            'wrong-business',
          ]
        )
      ).resolves.toEqual({
        rows: [{ outcome: 'business_mismatch', provider_customer_id: null }],
      });
      await admin.query(
        'UPDATE piggyvest_staging.integrations SET enabled = false WHERE id = $1',
        [configuration.integrationId]
      );
      try {
        await expect(
          recoveryStore.readCustomerMapping(customerIds[0])
        ).resolves.toEqual({ outcome: 'disabled', provider_customer_id: null });
      } finally {
        await admin.query(
          'UPDATE piggyvest_staging.integrations SET enabled = true WHERE id = $1',
          [configuration.integrationId]
        );
      }
      const stored = await admin.query(
        "SELECT status, provider_customer_id, provider_wallet_id FROM piggyvest_staging.provisioning_intents WHERE customer_id = $1 AND operation = 'create_customer'",
        [customerIds[0]]
      );
      expect(stored.rows).toEqual([
        {
          status: 'awaiting_confirmation',
          provider_customer_id: 'synthetic-customer-committed',
          provider_wallet_id: 'synthetic-wallet-committed',
        },
      ]);
      await admin.query(
        "UPDATE public.customer_savings_goals SET merchant_id = '11111111-1111-4111-8111-111111111112' WHERE id = $1",
        [goalId]
      );
      try {
        await expect(
          recoveryStore.readCustomerMapping(customerIds[0])
        ).resolves.toEqual({ outcome: 'conflict', provider_customer_id: null });
      } finally {
        await admin.query(
          "UPDATE public.customer_savings_goals SET merchant_id = '11111111-1111-4111-8111-111111111111' WHERE id = $1",
          [goalId]
        );
      }
      const conflictingGoalId = '33333333-3333-4333-8333-333333333334';
      await admin.query(
        'INSERT INTO public.customer_savings_goals (id, merchant_id, customer_id) VALUES ($1, $2, $3)',
        [conflictingGoalId, configuration.expectedMerchantId, customerIds[1]]
      );
      await admin.query(
        'ALTER TABLE piggyvest_staging.wallet_goal_mappings DISABLE TRIGGER guard_wallet_goal_mapping_rows'
      );
      try {
        await admin.query(
          'INSERT INTO piggyvest_staging.wallet_goal_mappings (integration_id, provider_wallet_id, provider_customer_id, merchant_id, customer_id, goal_id) VALUES ($1, $2, $3, $4, $5, $6)',
          [
            configuration.integrationId,
            'synthetic-cross-customer-wallet',
            'synthetic-customer-committed',
            configuration.expectedMerchantId,
            customerIds[1],
            conflictingGoalId,
          ]
        );
      } finally {
        await admin.query(
          'ALTER TABLE piggyvest_staging.wallet_goal_mappings ENABLE TRIGGER guard_wallet_goal_mapping_rows'
        );
      }
      try {
        await expect(
          recoveryStore.readCustomerMapping(customerIds[0])
        ).resolves.toEqual({ outcome: 'conflict', provider_customer_id: null });
      } finally {
        await admin.query(
          'ALTER TABLE piggyvest_staging.wallet_goal_mappings DISABLE TRIGGER guard_wallet_goal_mapping_rows'
        );
        await admin.query(
          'DELETE FROM piggyvest_staging.wallet_goal_mappings WHERE provider_wallet_id = $1',
          ['synthetic-cross-customer-wallet']
        );
        await admin.query(
          'ALTER TABLE piggyvest_staging.wallet_goal_mappings ENABLE TRIGGER guard_wallet_goal_mapping_rows'
        );
      }
      await admin.query(
        'ALTER TABLE piggyvest_staging.provisioning_intents DISABLE TRIGGER guard_provisioning_intent_rows'
      );
      try {
        await admin.query(
          "UPDATE piggyvest_staging.provisioning_intents SET provider_customer_id = 'synthetic-stale-customer' WHERE customer_id = $1 AND operation = 'create_customer'",
          [customerIds[0]]
        );
      } finally {
        await admin.query(
          'ALTER TABLE piggyvest_staging.provisioning_intents ENABLE TRIGGER guard_provisioning_intent_rows'
        );
      }
      try {
        await expect(
          recoveryStore.readCustomerMapping(customerIds[0])
        ).resolves.toEqual({ outcome: 'conflict', provider_customer_id: null });
      } finally {
        await admin.query(
          'ALTER TABLE piggyvest_staging.provisioning_intents DISABLE TRIGGER guard_provisioning_intent_rows'
        );
        await admin.query(
          "UPDATE piggyvest_staging.provisioning_intents SET provider_customer_id = 'synthetic-customer-committed' WHERE customer_id = $1 AND operation = 'create_customer'",
          [customerIds[0]]
        );
        await admin.query(
          'ALTER TABLE piggyvest_staging.provisioning_intents ENABLE TRIGGER guard_provisioning_intent_rows'
        );
      }
    });

    it('dispatches only once when callers race for the same customer', async () => {
      const fetchImplementation = vi.fn(async () =>
        acknowledgement('concurrent')
      );
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          provisionPiggyvestStagingResource({
            configuration,
            command: command(customerIds[1]),
            execute,
            fetchImplementation,
          })
        )
      );
      expect(
        results.filter((result) => result.status === 'awaiting_confirmation')
      ).toHaveLength(1);
      expect(
        results.every((result) =>
          [
            'awaiting_confirmation',
            'already_dispatched',
            'not_claimed',
          ].includes(result.status)
        )
      ).toBe(true);
      expect(fetchImplementation).toHaveBeenCalledOnce();
    });

    it('persists response loss as unknown and never automatically resends', async () => {
      const fetchImplementation = vi.fn(async () => {
        throw new Error('Synthetic response loss');
      });
      const input = {
        configuration,
        command: command(customerIds[2]),
        execute,
        fetchImplementation,
      };
      expect((await provisionPiggyvestStagingResource(input)).status).toBe(
        'unknown'
      );
      expect((await provisionPiggyvestStagingResource(input)).status).toBe(
        'already_dispatched'
      );
      expect(fetchImplementation).toHaveBeenCalledOnce();
      const stored = await admin.query(
        'SELECT status, attempts FROM piggyvest_staging.provisioning_intents WHERE customer_id = $1',
        [customerIds[2]]
      );
      expect(stored.rows).toEqual([{ status: 'unknown', attempts: 1 }]);
    });
  }
);

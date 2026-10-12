import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { piggyvestPostgresConfigurationSchema } from '@/schemas/piggyvest-postgres-configuration';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { provisionPiggyvestStagingResource } from './provisioning-client';
import { recoverPiggyvestProvisioning } from './provisioning-recovery-client';
import { buildPiggyvestProvisioningRequest } from './provisioning-request';
import { createPiggyvestProvisioningStore } from './provisioning-store';

vi.mock('server-only', () => ({}));

describe.skipIf(process.env.PIGGYVEST_RUN_LOCAL_POSTGRES !== '1')(
  'wallet naming with committed local provisioning storage',
  () => {
    let admin: Client;
    let execute: ReturnType<typeof createPiggyvestPostgresExecutor>;
    const customerId = '22222222-2222-4222-8222-222222222224';
    const configuration = {
      environment: 'staging',
      integrationId: '44444444-4444-4444-8444-444444444444',
      expectedMerchantId: '11111111-1111-4111-8111-111111111111',
      expectedProjectId: 'synthetic-project',
      actualProjectId: 'synthetic-project',
      allowlistedCustomerIds: [customerId],
      provisioningApproved: true,
      syntheticIdentityApproved: true,
      defaultInterestRoutingVerified: true,
      fingerprintKey: 'synthetic-fingerprint-key-at-least-32-bytes',
      apiSecret: 'synthetic-provider-secret',
      expectedBusinessId: 'synthetic-business',
    };
    const storage = {
      environment: configuration.environment,
      integrationId: configuration.integrationId,
      expectedMerchantId: configuration.expectedMerchantId,
      expectedBusinessId: configuration.expectedBusinessId,
    };
    const goalIds = [
      '33333333-3333-4333-8333-333333333341',
      '33333333-3333-4333-8333-333333333342',
      '33333333-3333-4333-8333-333333333343',
    ];
    const command = (goalId: string, customerName?: string) => ({
      kind: 'create_plan_wallet',
      merchantId: configuration.expectedMerchantId,
      customerId,
      goalId,
      providerCustomerId: 'synthetic-naming-customer',
      reserveVirtualAccount: true,
      enableInterestAccrual: false,
      interestPayout: 'own_wallet',
      ...(customerName === undefined ? {} : { customerName }),
    });
    const acknowledgeWallet = (walletId: string) =>
      vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ status: true, data: { id: walletId } })
      );

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
        connectionTimeoutMillis: 1000,
        query_timeout: 3000,
        options: '-c search_path=pg_catalog -c statement_timeout=2500',
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(() => {
          throw new Error('External HTTP prohibited');
        })
      );
      await admin.connect();
      await admin.query(
        'INSERT INTO public.customers (id, merchant_id) VALUES ($1, $2)',
        [customerId, configuration.expectedMerchantId]
      );
      for (const goalId of goalIds) {
        await admin.query(
          'INSERT INTO public.customer_savings_goals (id, merchant_id, customer_id) VALUES ($1, $2, $3)',
          [goalId, configuration.expectedMerchantId, customerId]
        );
      }
      const customer = await provisionPiggyvestStagingResource({
        configuration,
        execute,
        command: {
          kind: 'create_customer',
          merchantId: configuration.expectedMerchantId,
          customerId,
          bvn: '00000000000',
          email: 'synthetic-naming@example.test',
          name: 'Synthetic Customer',
          phone: '+2340000000000',
          enableInterestAccrual: false,
          interestPayout: 'own_wallet',
        },
        fetchImplementation: vi.fn(async () =>
          Response.json({
            status: true,
            data: {
              customer_id: 'synthetic-naming-customer',
              wallet_id: 'synthetic-naming-default',
              new_customer: true,
            },
          })
        ),
      });
      expect(customer.status).toBe('awaiting_confirmation');
      expect(
        await recoverPiggyvestProvisioning({
          configuration: {
            storage,
            wallet: {
              apiSecret: configuration.apiSecret,
              expectedBusinessId: configuration.expectedBusinessId,
            },
          },
          scope: { intentId: customer.intentId, customerId, goalId: null },
          execute,
          fetchImplementation: vi.fn(async () =>
            Response.json({
              status: true,
              data: {
                id: 'synthetic-naming-default',
                business_id: configuration.expectedBusinessId,
                currency: 'NGN',
                status: 'active',
              },
            })
          ),
        })
      ).toEqual({ status: 'completed' });
    });

    afterAll(async () => {
      try {
        expect(globalThis.fetch).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
        await admin?.end();
      }
    });

    it('keeps a legacy account and its original fingerprint after the naming rollout', async () => {
      const fetchImplementation = acknowledgeWallet('synthetic-naming-legacy');
      const legacy = await provisionPiggyvestStagingResource({
        configuration,
        execute,
        command: command(goalIds[0]),
        fetchImplementation,
      });
      expect(legacy.status).toBe('awaiting_confirmation');
      const retry = await provisionPiggyvestStagingResource({
        configuration,
        execute,
        command: command(goalIds[0], 'Synthetic Customer'),
        fetchImplementation,
      });

      expect(retry).toEqual({
        status: 'already_dispatched',
        intentId: legacy.intentId,
      });
      expect(fetchImplementation).toHaveBeenCalledOnce();
      const stored = await admin.query(
        "SELECT attempts, encode(request_fingerprint, 'hex') AS fingerprint FROM piggyvest_staging.provisioning_intents WHERE goal_id = $1",
        [goalIds[0]]
      );
      expect(stored.rows).toEqual([
        {
          attempts: 1,
          fingerprint: buildPiggyvestProvisioningRequest({
            configuration,
            command: command(goalIds[0]),
          }).requestFingerprint,
        },
      ]);
    });

    it('finishes an unclaimed legacy request using the exact original bytes', async () => {
      const legacyRequest = buildPiggyvestProvisioningRequest({
        configuration,
        command: command(goalIds[1]),
      });
      await createPiggyvestProvisioningStore({
        configuration: storage,
        execute,
      }).prepare({
        kind: legacyRequest.kind,
        merchantId: legacyRequest.merchantId,
        customerId: legacyRequest.customerId,
        goalId: legacyRequest.goalId,
        providerCustomerId: legacyRequest.providerCustomerId,
        requestFingerprint: legacyRequest.requestFingerprint,
      });
      const fetchImplementation = acknowledgeWallet('synthetic-naming-pending');

      expect(
        (
          await provisionPiggyvestStagingResource({
            configuration,
            execute,
            command: command(goalIds[1], 'Synthetic Customer'),
            fetchImplementation,
          })
        ).status
      ).toBe('awaiting_confirmation');
      expect(fetchImplementation.mock.calls[0][1]?.body).toBe(
        legacyRequest.body
      );
      const changed = await provisionPiggyvestStagingResource({
        configuration,
        execute,
        command: {
          ...command(goalIds[1], 'Synthetic Customer'),
          enableInterestAccrual: true,
        },
        fetchImplementation,
      });
      expect(changed.status).toBe('conflict');
      expect(fetchImplementation).toHaveBeenCalledOnce();
    });

    it('commits only one new readable wallet intent and dispatch when eight callers race', async () => {
      const fetchImplementation = acknowledgeWallet('synthetic-naming-new');
      const namedCommand = command(goalIds[2], 'Synthetic Customer');
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          provisionPiggyvestStagingResource({
            configuration,
            execute,
            command: namedCommand,
            fetchImplementation,
          })
        )
      );

      expect(results.map((result) => result.status)).toContain(
        'awaiting_confirmation'
      );
      expect(fetchImplementation).toHaveBeenCalledOnce();
      expect(
        JSON.parse(String(fetchImplementation.mock.calls[0][1]?.body))
          .subaccount_name
      ).toMatch(/^Synthetic Customer Savings [A-F0-9]{16}$/);
      const retry = await provisionPiggyvestStagingResource({
        configuration,
        execute,
        command: namedCommand,
        fetchImplementation,
      });
      expect(retry.status).toBe('already_dispatched');
      const stored = await admin.query(
        'SELECT attempts FROM piggyvest_staging.provisioning_intents WHERE goal_id = $1',
        [goalIds[2]]
      );
      expect(stored.rows).toEqual([{ attempts: 1 }]);
      expect(fetchImplementation).toHaveBeenCalledOnce();
    });
  }
);

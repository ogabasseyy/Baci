import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { Client } from 'pg';
import { expect, it, vi } from 'vitest';
import { checkCsrfProtection } from '@/lib/csrf';
import { piggyvestPostgresConfigurationSchema } from '@/schemas/piggyvest-postgres-configuration';
import { createPiggyvestCustomerPolicyHandler } from './customer-policy-handler';
import { activatePiggyvestGoalLifecycle } from './goal-lifecycle';
import { recordPiggyvestGoalLifecycleTerms } from './goal-lifecycle-terms';
import { createGoalPolicyStore } from './goal-policy-store';
import { createPiggyvestPostgresExecutor } from './postgres-executor';

const integrationTest = it.skipIf(
  process.env.PIGGYVEST_RUN_LIFECYCLE_RUNTIME !== '1'
);
const termsDocument = {
  version: 'synthetic-ceremony-v1',
  text: 'Synthetic lifecycle ceremony only.',
  hash: createHash('sha256')
    .update('Synthetic lifecycle ceremony only.')
    .digest('hex'),
};
const actorId = '90000000-0000-4000-8000-000000000001';
const token = 'a'.repeat(64);
async function fixture(sequence: number, prepared = true) {
  const goalId = `30000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  const revisionId = `70000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  const scope = {
    environment: 'staging' as const,
    integrationId: '40000000-0000-4000-8000-000000000001',
    merchantId: '10000000-0000-4000-8000-000000000001',
    customerId: '20000000-0000-4000-8000-000000000001',
    goalId,
    expectedBusinessId: 'synthetic-business',
  };
  const database = piggyvestPostgresConfigurationSchema.parse({
    environment: 'staging',
    transport: 'local_test',
    socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
    database: 'piggyvest_local',
    password: 'synthetic-local-only',
    role: 'piggyvest_staging_policy_writer',
    port: 55443,
  });
  const execute = createPiggyvestPostgresExecutor(database);
  const store = createGoalPolicyStore({ configuration: scope, execute });
  await store.stage({
    revisionId,
    expectedGoalUpdatedAt: '2026-09-12T00:00:00Z',
    productId: '50000000-0000-4000-8000-000000000001',
    variantId: '60000000-0000-4000-8000-000000000001',
    termsVersion: termsDocument.version,
    termsHash: termsDocument.hash,
    quoteId: 'synthetic-ceremony',
    quoteKobo: 100001,
    quoteExpiresAt: '2099-01-01T00:00:00Z',
    guarantee: null,
    lifecycle: 'draft',
    collectionPaused: true,
  });
  if (prepared)
    await recordPiggyvestGoalLifecycleTerms({
      enabled: true,
      database,
      scope,
      command: { action: 'prepare', revisionId, durationMonths: 1 },
    });
  const rows: Record<string, unknown> = {
    merchants: { id: scope.merchantId },
    customers: {
      id: scope.customerId,
      merchant_id: scope.merchantId,
      user_id: actorId,
    },
    customer_savings_goals: {
      id: goalId,
      merchant_id: scope.merchantId,
      customer_id: scope.customerId,
    },
  };
  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: actorId } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn(),
        eq: vi.fn(),
        maybeSingle: vi.fn(async () => ({ data: rows[table], error: null })),
      };
      query.select.mockReturnValue(query);
      query.eq.mockReturnValue(query);
      return query;
    }),
  } as unknown as SupabaseClient;
  const handler = createPiggyvestCustomerPolicyHandler({
    authenticate: async () => supabase,
    checkCsrfProtection,
    execute,
    termsDocument,
    configuration: {
      environment: scope.environment,
      integrationId: scope.integrationId,
      merchantId: scope.merchantId,
      expectedBusinessId: scope.expectedBusinessId,
      transport: 'local_test',
      allowlistedMerchantIds: [scope.merchantId],
      allowlistedCustomerIds: [scope.customerId],
      expectedProjectId: 'synthetic',
      actualProjectId: 'synthetic',
    },
  });
  const body = {
    goalId,
    revisionId,
    termsVersion: termsDocument.version,
    termsHash: termsDocument.hash,
    accepted: true,
  };
  const get = () =>
    handler.GET(
      new NextRequest(`https://synthetic.invalid/policy?goalId=${goalId}`)
    );
  const post = (value: unknown, csrf = true) =>
    handler.POST(
      new NextRequest('https://synthetic.invalid/policy', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(csrf
            ? { cookie: `csrf-token=${token}`, 'x-csrf-token': token }
            : {}),
        },
        body: JSON.stringify(value),
      })
    );
  async function credit() {
    if (database.transport !== 'local_test') throw new Error('Local only');
    const client = new Client({
      host: database.socketDirectory,
      port: database.port,
      database: database.database,
      user: 'goal_policy_other',
      connectionTimeoutMillis: 2000,
      statement_timeout: 2000,
      query_timeout: 3000,
    });
    try {
      await client.connect();
      await client.query(
        'SELECT goal_policy_test.lifecycle_credit($1::integer,5001,$2::integer)',
        [sequence, sequence + 1000]
      );
    } finally {
      await client.end();
    }
  }
  const activate = () =>
    activatePiggyvestGoalLifecycle({
      enabled: true,
      database,
      scope,
      command: { revisionId, operationId: goalId },
    });
  return {
    get,
    post,
    body,
    credit,
    activate,
    store,
    database,
    scope,
    revisionId,
  };
}

integrationTest(
  'performs prepared-duration GET/POST ceremony through concrete context, real CSRF and real database then permits activation',
  async () => {
    const test = await fixture(121);
    const first = await test.get();
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(await first.json()).toMatchObject({
      durationMonths: 1,
      consent: 'required',
      terms: termsDocument,
    });
    expect((await test.post(test.body)).status).toBe(409);
    expect((await test.post({ ...test.body, durationMonths: 2 })).status).toBe(
      409
    );
    expect(
      (await test.post({ ...test.body, durationMonths: 1 }, false)).status
    ).toBe(403);
    expect((await test.store.read())?.acceptedAt).toBeNull();
    const accepted = await test.post({ ...test.body, durationMonths: 1 });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      durationMonths: 1,
      consent: 'accepted',
    });
    const receipt = await test.store.read();
    expect((await test.post({ ...test.body, durationMonths: 1 })).status).toBe(
      200
    );
    expect(await test.store.read()).toEqual(receipt);
    await test.credit();
    await expect(test.activate()).resolves.toMatchObject({
      lifecycle: 'active',
      durationMonths: 1,
      collectionPaused: true,
    });
  }
);

integrationTest(
  'preserves generic draft consent as nonactivatable and rejects retrospective duration',
  async () => {
    const test = await fixture(122, false);
    expect(await (await test.get()).json()).not.toHaveProperty(
      'durationMonths'
    );
    expect((await test.post({ ...test.body, durationMonths: 1 })).status).toBe(
      409
    );
    expect((await test.post(test.body)).status).toBe(200);
    await expect(
      recordPiggyvestGoalLifecycleTerms({
        enabled: true,
        database: test.database,
        scope: test.scope,
        command: {
          action: 'prepare',
          revisionId: test.revisionId,
          durationMonths: 1,
        },
      })
    ).rejects.toThrow();
    await expect(test.activate()).rejects.toThrow('Goal lifecycle unavailable');
  }
);

integrationTest(
  'SQL rejects a direct generic receipt when a duration is prepared',
  async () => {
    const test = await fixture(123);
    await expect(
      test.store.accept({ revisionId: test.revisionId, actorId })
    ).rejects.toThrow('Goal policy storage unavailable');
    expect((await test.store.read())?.acceptedAt).toBeNull();
  }
);

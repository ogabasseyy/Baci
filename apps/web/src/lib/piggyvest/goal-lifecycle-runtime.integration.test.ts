import { Client } from 'pg';
import { expect, it } from 'vitest';
import { piggyvestPostgresConfigurationSchema } from '@/schemas/piggyvest-postgres-configuration';
import { activatePiggyvestGoalLifecycle } from './goal-lifecycle';
import { recordPiggyvestGoalLifecycleTerms } from './goal-lifecycle-terms';
import { createGoalPolicyStore } from './goal-policy-store';
import { createPiggyvestPostgresExecutor } from './postgres-executor';

const enabled = process.env.PIGGYVEST_RUN_LIFECYCLE_RUNTIME === '1';
const integrationTest = it.skipIf(!enabled);
const goal = (sequence: number) =>
  `30000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
const revision = (sequence: number) =>
  `70000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;

function configuration(sequence: number) {
  const database = piggyvestPostgresConfigurationSchema.parse({
    environment: 'staging',
    transport: 'local_test',
    socketDirectory: process.env.PIGGYVEST_LOCAL_TEST_SOCKET,
    database: 'piggyvest_local',
    password: 'synthetic-local-only',
    role: 'piggyvest_staging_policy_writer',
    port: 55443,
  });
  const scope = {
    environment: 'staging' as const,
    integrationId: '40000000-0000-4000-8000-000000000001',
    merchantId: '10000000-0000-4000-8000-000000000001',
    customerId: '20000000-0000-4000-8000-000000000001',
    goalId: goal(sequence),
    expectedBusinessId: 'synthetic-business',
  };
  return { enabled: true, database, scope };
}
async function stage(sequence: number) {
  const options = configuration(sequence);
  await createGoalPolicyStore({
    configuration: options.scope,
    execute: createPiggyvestPostgresExecutor(options.database),
  }).stage({
    revisionId: revision(sequence),
    expectedGoalUpdatedAt: '2026-09-12T00:00:00Z',
    productId: '50000000-0000-4000-8000-000000000001',
    variantId: '60000000-0000-4000-8000-000000000001',
    termsVersion: 'synthetic-v1',
    termsHash: 'a'.repeat(64),
    quoteId: 'synthetic-runtime',
    quoteKobo: 100001,
    quoteExpiresAt: '2099-01-01T00:00:00Z',
    guarantee: null,
    lifecycle: 'draft',
    collectionPaused: true,
  });
  await recordPiggyvestGoalLifecycleTerms({
    ...options,
    command: {
      action: 'prepare',
      revisionId: revision(sequence),
      durationMonths: 1,
    },
  });
  return options;
}
async function accept(sequence: number) {
  await recordPiggyvestGoalLifecycleTerms({
    ...configuration(sequence),
    command: {
      action: 'accept',
      revisionId: revision(sequence),
      durationMonths: 1,
      actorId: '90000000-0000-4000-8000-000000000001',
      accepted: true,
    },
  });
}
async function credit(sequence: number) {
  const { database } = configuration(sequence);
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
function activate(sequence: number) {
  return activatePiggyvestGoalLifecycle({
    ...configuration(sequence),
    command: { revisionId: revision(sequence), operationId: goal(sequence) },
  });
}

integrationTest(
  'commits selected duration and activates through actual restricted executor with durable replay',
  async () => {
    await stage(116);
    await accept(116);
    await credit(116);
    const first = await activate(116);
    expect(first).toMatchObject({
      guaranteeKobo: 100001,
      durationMonths: 1,
      collectionPaused: true,
      collectionConsent: 'not_granted',
      evidence: 'local_synthetic_only',
    });
    await expect(activate(116)).resolves.toEqual(first);
  }
);
integrationTest(
  'does not promote principal into activation without explicit duration consent',
  async () => {
    await stage(117);
    await credit(117);
    await expect(activate(117)).rejects.toThrow('Goal lifecycle unavailable');
    await expect(accept(117)).rejects.toThrow(
      'Goal lifecycle terms unavailable'
    );
  }
);
integrationTest(
  'does not acknowledge a deferred COMMIT failure or leave an activation on retry',
  async () => {
    await stage(118);
    await accept(118);
    await credit(118);
    await expect(activate(118)).rejects.toThrow('Goal lifecycle unavailable');
    await expect(activate(118)).rejects.toThrow('Goal lifecycle unavailable');
  }
);
integrationTest(
  'rejects a non-owner consent actor in the real database',
  async () => {
    const options = await stage(119);
    await expect(
      recordPiggyvestGoalLifecycleTerms({
        ...options,
        command: {
          action: 'accept',
          revisionId: revision(119),
          durationMonths: 1,
          actorId: '90000000-0000-4000-8000-000000000099',
          accepted: true,
        },
      })
    ).rejects.toThrow('Goal lifecycle terms unavailable');
  }
);

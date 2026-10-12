import { Client } from 'pg';
import { createFundingScreenFixture } from './customer-funding-screen.test-fixture';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';

const goal = (sequence: number) =>
  `${sequence < 801 ? '30000000' : 'abcdefab'}-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
function database() {
  const socketDirectory = process.env.PIGGYVEST_LOCAL_TEST_SOCKET;
  if (
    !socketDirectory ||
    !/^\/tmp\/baci-piggyvest-runtime\.[A-Za-z0-9]+\/socket$/.test(
      socketDirectory
    )
  )
    throw new Error('Owned local fixture required');
  return {
    environment: 'staging',
    transport: 'local_test',
    socketDirectory,
    database: 'piggyvest_local',
    password: 'synthetic-local-only',
    port: 55457,
    role: 'piggyvest_staging_policy_writer',
  };
}
async function admin() {
  const config = database();
  const client = new Client({
    host: config.socketDirectory,
    port: config.port,
    database: config.database,
    user: 'harness_admin',
    password: '',
    ssl: false,
  });
  await client.connect();
  return client;
}
function parameters(sequence: number) {
  return [
    '40000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    goal(sequence),
    'synthetic-business',
    '90000000-0000-4000-8000-000000000001',
  ];
}
function server(sequence: number) {
  const fixture = createFundingScreenFixture();
  return startPiggyvestRuntimeCompositionServer({
    port: 0,
    configuration: {
      mode: 'local_test',
      goalId: goal(sequence),
      context: fixture.options.configuration,
      termsDocument: fixture.options.termsDocument,
    },
    execute: createPiggyvestPostgresExecutor(database()),
    createRlsClient: (request) => {
      const current = createFundingScreenFixture();
      current.rows.customer_savings_goals = {
        id: goal(sequence),
        merchant_id: current.identity.merchantId,
        customer_id: current.identity.customerId,
      };
      if (request.cookies.get('synthetic-session')?.value !== 'owner') {
        current.getUser.mockResolvedValue({
          data: {
            user: {
              id:
                request.cookies.get('synthetic-session')?.value === 'other'
                  ? '90000000-0000-4000-8000-000000000002'
                  : '',
            },
          },
          error: null,
        });
      }
      return Promise.resolve(current.options.supabase);
    },
    services: { closure: { enabled: true } },
  });
}
async function waitForLock(observer: Client, pid: number) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const result = await observer.query<{ blocked: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',
      [pid]
    );
    if (result.rows[0]?.blocked) return;
  }
  throw new Error('Expected actual PostgreSQL lock was not observed');
}
export const draftClosureLocalFixture = {
  goal,
  database,
  admin,
  parameters,
  server,
  waitForLock,
};

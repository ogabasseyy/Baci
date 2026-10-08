import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { createPiggyvestPostgresExecutor } from './postgres-executor';
import {
  authenticatedReader,
  configuration,
  database,
  goal,
  query,
} from './purchase-pricing-runtime.fixture';
import { startPiggyvestRuntimeCompositionServer } from './runtime-composition-server';

export const termsDocument = {
  version: 'synthetic-http',
  text: 'Synthetic local purchase lifecycle consent only.',
  hash: createHash('sha256')
    .update('Synthetic local purchase lifecycle consent only.')
    .digest('hex'),
};
export function server(sequence: number, loseResponse = false) {
  const execute = createPiggyvestPostgresExecutor(database());
  let lose = loseResponse;
  return startPiggyvestRuntimeCompositionServer({
    port: 0,
    configuration: {
      mode: 'local_test',
      goalId: goal(sequence),
      context: configuration(),
      termsDocument,
    },
    services: { purchase: { enabled: true }, lifecycle: { enabled: true } },
    createRlsClient: async () => authenticatedReader(),
    execute: async (statement, parameters) => {
      const result = await execute(statement, parameters);
      if (lose && statement.includes('purchase_preparation.prepare(')) {
        lose = false;
        throw new Error('Synthetic committed response loss');
      }
      return result;
    },
  });
}
export async function client(origin: string) {
  const bootstrap = await fetch(`${origin}/csrf`, {
    headers: { origin, cookie: 'synthetic-session=customer' },
  });
  expect(bootstrap.status).toBe(200);
  const { csrfToken } = await bootstrap.json();
  const cookies = bootstrap.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
  return async (path: string, body?: unknown) =>
    fetch(`${origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin,
        cookie: `synthetic-session=customer; ${cookies}`,
        'x-csrf-token': csrfToken,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}
export async function stage(sequence: number, seconds = 120) {
  await query(
    'harness_admin',
    'INSERT INTO piggyvest_goal_policy.terms(version,sha256,enabled) VALUES($1,$2,true) ON CONFLICT DO NOTHING',
    [termsDocument.version, termsDocument.hash]
  );
  const response = await query(
    'piggyvest_staging_policy_writer',
    `SELECT piggyvest_goal_policy.stage('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',goal_policy_test.goal($1),'synthetic-business',goal_policy_test.command($1)||jsonb_build_object('termsVersion',$2::text,'termsHash',$3::text,'quoteKobo',100001,'quoteExpiresAt',to_char((clock_timestamp()+make_interval(secs=>$4)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))) AS result`,
    [sequence, termsDocument.version, termsDocument.hash, seconds]
  );
  return response.rows[0].result.revisionId;
}

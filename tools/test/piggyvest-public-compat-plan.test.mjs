import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { compatibilityPlan } from './piggyvest-public-compat-plan.mjs';

const body = Buffer.from('SELECT 1;');
const hash = createHash('sha256').update(body).digest('hex');
const registry = (rows) =>
  `export const SAVINGS_PENDING_REPLAY_SOURCE_ROWS = \`${rows.join('\n')}\`;\n\nexport const SAVINGS_ENGAGEMENT_PENDING_REPLAY_SOURCE_ROWS = \`\`;`;
test('includes public repairs before private drafts without duplicating a migration list', async () => {
  const names = [
    '20260912160000_cancel_plan_test.sql',
    '20260911204500_public_repair.sql',
  ];
  const plan = await compatibilityPlan(
    registry(names.map((name) => `${hash} ${name}`)),
    async () => body
  );
  assert.deepEqual(
    plan.map((entry) => entry.name),
    [...names].sort()
  );
});
test('reads the second explicitly named savings row export', async () => {
  const secondary = '20260925130050_customer_savings_engagement_storage.sql';
  const source = registry([
    `${hash} 20260926120000_piggyvest_staging_read.sql`,
  ]).replace(
    'SAVINGS_ENGAGEMENT_PENDING_REPLAY_SOURCE_ROWS = ``;',
    `SAVINGS_ENGAGEMENT_PENDING_REPLAY_SOURCE_ROWS = \`${hash} ${secondary}\`;`
  );
  const plan = await compatibilityPlan(source, async () => body);
  assert.deepEqual(
    plan.map((entry) => entry.name),
    [secondary, '20260926120000_piggyvest_staging_read.sql'].sort()
  );
});
test('rejects changed public repair bytes rather than only verifying private drafts', async () => {
  const name = '20260911204500_public_repair.sql';
  await assert.rejects(
    compatibilityPlan(registry([`${hash} ${name}`]), async () =>
      Buffer.from('SELECT 2;')
    ),
    /hash mismatch/
  );
});
test('rejects traversal, duplicate versions, code injection and unbounded input', async () => {
  for (const source of [
    registry([`${hash} ../bad.sql`]),
    registry([
      `${hash} 20260911204500_one.sql`,
      `${hash} 20260911204500_two.sql`,
    ]),
    `${registry([`${hash} 20260911204500_one.sql`])}process.exit();`,
    registry(
      Array.from(
        { length: 81 },
        (_, index) => `${hash} ${20260911204500 + index}_one.sql`
      )
    ),
  ])
    await assert.rejects(compatibilityPlan(source, async () => body));
});

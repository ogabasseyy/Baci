import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { planReplay } from './piggyvest-full-local-plan.mjs';

const body = Buffer.from('SELECT 1;\n');
const hash = createHash('sha256').update(body).digest('hex');
const inbox = '20260912080000_piggyvest_staging_webhook_inbox.sql';
const policy = '20260912140000_goal_policy_tables.sql';
const lifecycle = '20260912150000_goal_lifecycle_activation.sql';
const cancellation = '20260912160000_cancel_plan_intents.sql';
const recovery = '20260912161000_cancellation_recovery_read.sql';
const purchaseTables = '20260912162000_purchase_preparation_tables.sql';
const purchaseCommands = '20260912162100_purchase_preparation_commands.sql';
const connected = [
  '20260912164000_purchase_pricing_sources.sql',
  '20260912164100_purchase_pricing_publish.sql',
  '20260912164200_purchase_pricing_revalidation.sql',
  '20260912165000_schedule_proposal_storage.sql',
  '20260912165100_schedule_proposal_commit.sql',
  '20260912170000_customer_funding_capability.sql',
  '20260912171000_purchase_current_recovery.sql',
  '20260912172000_collection_reconciliation.sql',
  '20260912180000_device_change_versions.sql',
  '20260912180100_device_change_publication.sql',
  '20260912180200_device_change_confirmation.sql',
  '20260912180300_device_change_canonical_read.sql',
  '20260912180400_device_change_pricing.sql',
  '20260912180500_device_change_operations.sql',
  '20260912180600_device_change_lifecycle_funding.sql',
  '20260912181000_draft_closure.sql',
  '20260912181100_draft_closure_terminal_guards.sql',
  '20260912182000_protected_offer_publications.sql',
  '20260912182100_protected_offer_publish.sql',
  '20260912182200_protected_offer_pricing.sql',
  '20260912182300_protected_offer_quote_provenance.sql',
  '20260912182400_protected_offer_catalog.sql',
  '20260912182500_protected_offer_schedule.sql',
  '20260912183000_payment_leg_recovery.sql',
  '20260912184000_period_attribution_recovery.sql',
  '20260912185000_reconciliation_cases_read.sql',
];
test('selects exact pricing schedule and funding prefixes without lookalikes', async () => {
  const names = [
    ...connected.toReversed(),
    purchaseCommands,
    '20260912164300_other_purchase_pricing_sources.sql',
    '20260912164400_purchase_pricings_sources.sql',
    '20260912165200_other_schedule_proposal_storage.sql',
    '20260912165300_schedule_proposals_storage.sql',
    '20260912170100_other_customer_funding_capability.sql',
    '20260912170200_customer_fundings_capability.sql',
    '20260912171100_other_purchase_current_recovery.sql',
    '20260912171200_purchase_current_recoverys.sql',
    '20260912172100_other_collection_reconciliation.sql',
    '20260912172200_collection_reconciliations.sql',
    '20260912181200_other_draft_closure.sql',
    '20260912181300_draft_closures.sql',
    '20260912180700_other_device_change.sql',
    '20260912180800_device_changes.sql',
    '20260912182600_other_protected_offer.sql',
    '20260912182700_protected_offers.sql',
    '20260912183100_other_payment_leg_recovery.sql',
    '20260912183200_payment_leg_recoverys.sql',
    '20260912184100_other_period_attribution_recovery.sql',
    '20260912184200_period_attribution_recoverys.sql',
    '20260912185100_other_reconciliation_cases_read.sql',
    '20260912185200_reconciliation_caseslike_read.sql',
  ];
  const plan = await planReplay(
    registry(names.map((name) => `${hash} ${name}`)),
    async () => body
  );
  assert.deepEqual(
    plan.map((entry) => entry.name),
    [purchaseCommands, ...connected]
  );
});
for (const migration of connected) {
  test(`rejects changed connected draft bytes: ${migration}`, async () => {
    await assert.rejects(
      planReplay(
        registry([`${hash} ${policy}`, `${hash} ${migration}`]),
        async (name) => (name === migration ? Buffer.from('SELECT 2;') : body)
      ),
      /hash mismatch/
    );
  });
}
const registry = (rows) =>
  `export const SAVINGS_PENDING_REPLAY_SOURCE_ROWS = \`${rows.join('\n')}\`;\n\nexport const SAVINGS_ENGAGEMENT_PENDING_REPLAY_SOURCE_ROWS = \`\`;\n`;
test('orders registered staging drafts and excludes legacy savings repairs', async () => {
  const names = [];
  const plan = await planReplay(
    registry([
      `${hash} ${policy}`,
      `${hash} 20260911204500_legacy_savings.sql`,
      `${hash} ${inbox}`,
    ]),
    async (name) => {
      names.push(name);
      return await Promise.resolve(body);
    }
  );
  assert.deepEqual(
    plan.map((entry) => entry.name),
    [inbox, policy]
  );
  assert.deepEqual(names, [inbox, policy]);
  assert.equal(plan[0].body, body);
});
test('includes registered exact goal_lifecycle prefix after policy dependencies', async () => {
  const plan = await planReplay(
    registry([
      `${hash} ${lifecycle}`,
      `${hash} 20260912150100_other_goal_lifecycle_activation.sql`,
      `${hash} 20260912150200_goal_lifecyclelike_activation.sql`,
      `${hash} ${policy}`,
      `${hash} ${inbox}`,
    ]),
    async () => body
  );
  assert.deepEqual(
    plan.map((entry) => entry.name),
    [inbox, policy, lifecycle]
  );
});
test('verifies registered lifecycle migration bytes rather than skipping them', async () => {
  await assert.rejects(
    planReplay(
      registry([`${hash} ${inbox}`, `${hash} ${lifecycle}`]),
      async (name) => (name === lifecycle ? Buffer.from('SELECT 2;') : body)
    ),
    /hash mismatch/
  );
});
test('includes only the exact cancel_plan prefix after its dependencies', async () => {
  const plan = await planReplay(
    registry([
      `${hash} ${cancellation}`,
      `${hash} ${lifecycle}`,
      `${hash} ${policy}`,
      `${hash} 20260912160100_other_cancel_plan_intents.sql`,
      `${hash} 20260912160200_cancel_plans_intents.sql`,
    ]),
    async () => body
  );
  assert.deepEqual(
    plan.map((entry) => entry.name),
    [policy, lifecycle, cancellation]
  );
});
test('verifies cancel_plan bytes rather than silently excluding them', async () => {
  await assert.rejects(
    planReplay(
      registry([`${hash} ${policy}`, `${hash} ${cancellation}`]),
      async (name) => (name === cancellation ? Buffer.from('SELECT 2;') : body)
    ),
    /hash mismatch/
  );
});
test('includes exact recovery and purchase prefixes in dependency order, not lookalikes', async () => {
  const plan = await planReplay(
    registry(
      [
        purchaseCommands,
        recovery,
        purchaseTables,
        cancellation,
        policy,
        '20260912161100_other_cancellation_recovery_read.sql',
        '20260912161200_cancellation_recoverys_read.sql',
        '20260912162200_other_purchase_preparation_tables.sql',
        '20260912162300_purchase_preparations_tables.sql',
      ].map((name) => `${hash} ${name}`)
    ),
    async () => body
  );
  assert.deepEqual(
    plan.map((entry) => entry.name),
    [policy, cancellation, recovery, purchaseTables, purchaseCommands]
  );
});
for (const migration of [recovery, purchaseTables, purchaseCommands]) {
  test(`verifies registered bytes for ${migration}`, async () => {
    await assert.rejects(
      planReplay(
        registry([`${hash} ${policy}`, `${hash} ${migration}`]),
        async (name) => (name === migration ? Buffer.from('SELECT 2;') : body)
      ),
      /hash mismatch/
    );
  });
}
test('rejects altered migration bytes before returning a replay plan', async () => {
  await assert.rejects(
    planReplay(registry([`${hash} ${inbox}`]), async () =>
      Buffer.from('SELECT 2;')
    ),
    /hash mismatch/
  );
});
test('rejects duplicate versions, malformed rows, paths and empty scope', async () => {
  for (const rows of [
    [`${hash} ${inbox}`, `${hash} ${inbox}`],
    [`${hash} ${inbox}`, `${hash} 20260912090000_piggyvest_other.sql`],
    [`${hash} ../${inbox}`],
    [`bad ${inbox}`],
    [`${hash} 20260911204500_legacy_savings.sql`],
  ])
    await assert.rejects(planReplay(registry(rows), async () => body));
});
test('does not evaluate injected registry code', async () => {
  await assert.rejects(
    planReplay(
      `${registry([`${hash} ${inbox}`])}throw new Error('injected');`,
      async () => body
    ),
    /registry format/
  );
});
test('reads both explicitly registered savings row exports and rejects a third export', async () => {
  const secondExportMigration = '20260925130000_piggyvest_staging_registry.sql';
  const source = registry([`${hash} ${inbox}`]).replace(
    'SAVINGS_ENGAGEMENT_PENDING_REPLAY_SOURCE_ROWS = ``;',
    `SAVINGS_ENGAGEMENT_PENDING_REPLAY_SOURCE_ROWS = \`${hash} ${secondExportMigration}\`;`
  );
  const plan = await planReplay(source, async () => body);
  assert.deepEqual(
    plan.map((entry) => entry.name),
    [inbox, secondExportMigration]
  );
  await assert.rejects(
    planReplay(`${source}export const EXTRA_ROWS = \`\`;`, async () => body),
    /registry format rejected/
  );
});
test('propagates missing migration failures', async () => {
  await assert.rejects(
    planReplay(registry([`${hash} ${inbox}`]), () =>
      Promise.reject(new Error('missing file'))
    ),
    /missing file/
  );
});

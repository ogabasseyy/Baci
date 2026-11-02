// Contract tests proving the money-path configuration covers the money code
// that already exists. The definitions below are deliberately independent of
// .github/money-path-paths.json, so weakening the configuration fails here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { loadRawConfig } from './money-pr-assurance.test-support.mjs';
import {
  classifyChangedFiles,
  parseAssuranceConfig,
} from './money-pr-assurance-config.mjs';

const config = parseAssuranceConfig(loadRawConfig());
const repoRoot = new URL('../../', import.meta.url).pathname;

// Server-side and tooling roots, where code can move or record money.
// Interface code (components, mobile screens) and documentation are not.
const SERVER_ROOTS = [
  'apps/web/src/app/',
  'apps/web/src/config/',
  'apps/web/src/lib/',
  'apps/web/src/schemas/',
  'apps/web/src/scripts/',
  'apps/web/tools/',
  'packages/shared/src/',
  'supabase/',
  'tools/',
  'vps-workers/',
];
const MONEY_WORDS =
  /piggyvest|wallet|savings|prefunded|primary[-_](?:card|bank|inflow|interest)|store[-_]credit|plan[-_]transfer/i;

function isMoney(path) {
  return classifyChangedFiles([{ filename: path, status: 'modified' }], config)
    .isMoneyPath;
}

test('every tracked server file named for wallet, savings or PiggyVest money is a money path', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const candidates = tracked.filter(
    (path) =>
      SERVER_ROOTS.some((root) => path.startsWith(root)) &&
      MONEY_WORDS.test(path)
  );
  assert.ok(candidates.length > 0, 'the sweep must see money files');
  const missed = candidates.filter((path) => !isMoney(path));
  assert.deepEqual(missed.slice(0, 20), [], `${missed.length} missed`);
});

test('money code whose file name lacks those words is still a money path', () => {
  for (const path of [
    // Paystack deliveries for PiggyVest primary-card custody.
    'apps/web/src/app/api/payments/webhook/paystack-key-family-dispatch.ts',
    'apps/web/src/app/api/payments/webhook/route.ts',
    // Airtime and IMEI paths governed by the "delivered means owed" rule.
    'apps/web/src/app/api/vtu/checkout/confirm/route.ts',
    'apps/web/src/lib/vtu-checkout-customer-rpcs.ts',
    'apps/web/src/lib/imei-lookup-fulfillment.ts',
    // Prefunded-card and primary-wallet runtime, schemas and workers.
    'apps/web/src/scripts/run-prefunded-card-background.ts',
    'apps/web/src/schemas/prefunded-card-provider.ts',
    'apps/web/src/schemas/primary-restricted-readiness.ts',
    'apps/web/src/schemas/cancel-plan.ts',
    'apps/web/src/schemas/purchase-pricing.ts',
    'tools/staging/interest-bridge/plan_goal.sql',
    // Database work on custody, transfers, goals and store credit.
    'supabase/migrations/20261008094000_primary_card_transfer_requeue.sql',
    'supabase/migrations/20261004160000_plan_transfer_goal_projection.sql',
    'supabase/migrations/20261031001000_harden_finalize_store_credit_order_payment.sql',
    'supabase/migrations/tests/plan_transfer_goal_projection.sql',
    'supabase/tests/finalize_store_credit_order_payment_refusals.sql',
    'apps/web/tools/db/replay-registry/20261008094000_primary_card_transfer_requeue/sql-checks.txt',
    'apps/web/tools/db/supabase-history-replay-primary-pending-sources.ts',
    // Shared contracts and libraries, at any depth.
    'packages/shared/src/lib/piggyvest-purchase-money.ts',
    'packages/shared/src/contracts/piggyvest-payment-leg-recovery.ts',
    // Files later PiggyVest tasks plan to add.
    'apps/web/src/lib/wallet-pin/verify.ts',
    'vps-workers/bin/piggyvest-webhook-capture-drain',
    'supabase/tests/helpers/piggyvest_engine.sql',
    'tools/piggyvest-ops/approve.mjs',
  ]) {
    assert.ok(isMoney(path), `${path} must be a money path`);
  }
});

test('interface code, documentation and look-alike names are not money paths', () => {
  for (const path of [
    'apps/web/src/components/wallet/wallet-card.tsx',
    'apps/mobile-storefront/components/wallet/balance.tsx',
    'docs/piggyvest-staging-readiness.md',
    'apps/web/src/app/page.tsx',
    'supabase/migrations/20260730000109_reject_merchant_identity_primary_key_reassignment.sql',
    'apps/web/src/lib/email-templates/order-receipt.ts',
  ]) {
    assert.ok(!isMoney(path), `${path} must not be a money path`);
  }
});

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

// Interface code (web components, mobile screens) and documentation are
// the only places a money-named file may sit outside the money paths. This
// list is independent of the configuration's roots on purpose.
const INTERFACE_OR_DOCS = [
  /^docs\//,
  /^\.superpowers\//,
  /\/components\//,
  /^apps\/mobile-[a-z]+\/(?:app|__tests__|qa|test-support|constants)\//,
];
const MONEY_WORDS =
  /piggyvest|wallet|savings|prefunded|primary[-_](?:card|bank|inflow|interest)|store[-_]credit|plan[-_]transfer/i;

function isMoney(path) {
  return classifyChangedFiles([{ filename: path, status: 'modified' }], config)
    .isMoneyPath;
}

test('every tracked non-interface file named for wallet, savings or PiggyVest money is a money path', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const candidates = tracked.filter(
    (path) =>
      MONEY_WORDS.test(path) &&
      !INTERFACE_OR_DOCS.some((pattern) => pattern.test(path))
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
    // Airtime and IMEI paths governed by the "delivered means owed" rule:
    // wallet debits, refunds and their recovery.
    'apps/web/src/app/api/vtu/checkout/confirm/route.ts',
    'apps/web/src/app/api/vtu/purchase/route.ts',
    'apps/web/src/app/api/cron/reconcile-vtu-processing/route.ts',
    'apps/web/src/lib/vtu-checkout-customer-rpcs.ts',
    'apps/web/src/lib/vtu-fulfillment-refund.ts',
    'apps/web/src/lib/vtu-debit-ledger-lookup.ts',
    'apps/web/src/lib/imei-lookup-fulfillment.ts',
    'apps/web/src/app/api/storefront/imei-check/execute-imei-lookup.ts',
    'apps/web/src/app/api/storefront/imei-check/route-cache-helpers.ts',
    'apps/web/src/app/api/storefront/imei-check/refund-unsubmitted-petrock-lookup.ts',
    // Payment confirmation that funds wallets.
    'apps/web/src/lib/payments/confirm-paystack-dva-by-order-account.ts',
    'apps/web/src/app/api/payments/juicyway/webhook/route.ts',
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
    // Hyphen and underscore spellings match alike, at any depth.
    'apps/web/src/schemas/purchase-preparation.ts',
    'apps/web/src/schemas/purchase_pricing.ts',
    'tools/staging/interest_bridge/plan.py',
    'apps/web/src/lib/vtu/fulfil.ts',
    'apps/web/src/lib/vtufulfillment.ts',
    'apps/web/src/lib/imei-lookup-fulfillment/refund.ts',
    // Mobile clients' money calls, hooks and schemas.
    'apps/mobile-storefront/lib/piggyvest/plan-wallet-live-service.ts',
    'apps/mobile-storefront/lib/customer-savings-plan-funding.ts',
    'apps/mobile-storefront/hooks/use-wallet-funding.ts',
    'apps/mobile-storefront/services/wallet-api.ts',
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
    'apps/mobile-storefront/app/wallet/index.tsx',
    'docs/piggyvest-staging-readiness.md',
    'apps/web/src/app/page.tsx',
    'supabase/migrations/20260730000109_reject_merchant_identity_primary_key_reassignment.sql',
    'apps/web/src/lib/email-templates/order-receipt.ts',
    'apps/web/src/lib/email-templates/vtu-token-receipt.ts',
  ]) {
    assert.ok(!isMoney(path), `${path} must not be a money path`);
  }
});

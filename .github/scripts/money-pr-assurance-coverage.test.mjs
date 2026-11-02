// Contract tests proving the money-path configuration covers the money code
// that already exists. What counts as money code is decided here from each
// file's contents (the database money functions it calls or defines, and the
// money API routes it calls), never from the configuration's paths or words,
// so a gap in the configuration fails here.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadRawConfig } from './money-pr-assurance.test-support.mjs';
import {
  classifyChangedFiles,
  parseAssuranceConfig,
} from './money-pr-assurance-config.mjs';

const config = parseAssuranceConfig(loadRawConfig());
const repoRoot = new URL('../../', import.meta.url).pathname;

// A database function moves or holds money when its name names a money
// noun. Pure reads (get_, list_, ...) are left out.
const MONEY_NOUN =
  /wallet|savings|piggyvest|store_?credit|prefund|primary_(?:card|bank|inflow|interest)|plan_transfer|refund|payout|payment|vtu|airtime|imei|petrock|loyalty|ledger|settle|withdraw|debit|bnpl|klump|redvault|credit_direct|shipping_charge/i;
const READ_ONLY = /^(?:get|list|count|search|read|is|has|can)_/i;
const RPC_CALL = /\.rpc\s*(?:<[^>]*>)?\s*\(\s*['"`]([a-z0-9_]+)['"`]/gi;
const SQL_FUNCTION =
  /create\s+(?:or\s+replace\s+)?function\s+(?:[a-z_]+\.)?"?([a-z0-9_]+)/gi;
// A call to one of the app's own money endpoints, from any client.
const MONEY_ROUTE =
  /['"`]\/api\/(?:[a-z0-9[\]-]+\/)*(?:wallet|savings|piggyvest|payments?|payouts?|refunds?|vtu|imei-check|loyalty)(?:[/?'"`$]|-)/i;
const CODE = /\.(?:ts|tsx|js|jsx|mjs|cjs|sql|py|sh)$/;
// Tests, fixtures and generated types describe money code without running
// it; route tables name money routes without calling them.
const NOT_RUNTIME = [
  /(?:^|\/)(?:__tests__|tests?|test-support|fixtures?|__mocks__)\//,
  /\.(?:test|spec|test-support|test-utils|test-fixtures)\.[a-z]+$/,
  /^apps\/web\/src\/types\/supabase\.ts$/,
  /^apps\/web\/src\/lib\/(?:proxy\/|rate-limit)/,
  /^docs\//,
];

function moneyOperation(text) {
  for (const pattern of [RPC_CALL, SQL_FUNCTION]) {
    for (const [, name] of text.matchAll(pattern)) {
      if (MONEY_NOUN.test(name) && !READ_ONLY.test(name)) return name;
    }
  }
  return MONEY_ROUTE.exec(text)?.[0] ?? null;
}

function isMoney(path, patch) {
  return classifyChangedFiles(
    [{ filename: path, status: 'modified', patch }],
    config
  ).isMoneyPath;
}

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((path) => CODE.test(path));
}

test('every tracked file that runs a money operation is a money path', () => {
  const operations = [];
  for (const path of trackedFiles()) {
    if (NOT_RUNTIME.some((pattern) => pattern.test(path))) continue;
    let text;
    try {
      text = readFileSync(`${repoRoot}${path}`, 'utf8');
    } catch {
      continue; // listed by git but absent from a sparse checkout
    }
    const operation = moneyOperation(text);
    // The whole file stands in for its diff: any change to it is judged.
    if (operation) operations.push({ path, operation, text });
  }
  assert.ok(operations.length > 500, 'the sweep must see the money code');
  const missed = operations
    .filter(({ path, text }) => !isMoney(path, text))
    .map(({ path, operation }) => `${path} (${operation})`);
  assert.deepEqual(missed.slice(0, 25), [], `${missed.length} missed`);
});

test('every tracked wallet, savings or PiggyVest file is a money path, interface code included', () => {
  const named = trackedFiles().filter(
    (path) =>
      !path.startsWith('docs/') &&
      /piggyvest|wallet|savings|prefunded|store[-_]?credit/i.test(path)
  );
  assert.ok(named.length > 500, 'the sweep must see money files');
  const missed = named.filter((path) => !isMoney(path, ''));
  assert.deepEqual(missed.slice(0, 20), [], `${missed.length} missed`);
});

test('named money code is a money path whatever folder it sits in', () => {
  for (const path of [
    // Mobile wallet charge and savings logic inside interface folders.
    'apps/mobile-storefront/components/wallet/fund-primary-wallet-card.ts',
    'apps/mobile-storefront/components/wallet/fund-primary-wallet-card-amount.ts',
    'apps/mobile-storefront/components/wallet/use-wallet-savings-actions.ts',
    'apps/mobile-storefront/components/wallet/balance.tsx',
    'apps/mobile-storefront/app/wallet/index.tsx',
    'apps/web/src/components/wallet/wallet-card.tsx',
    // Paystack deliveries for PiggyVest primary-card custody.
    'apps/web/src/app/api/payments/webhook/paystack-key-family-dispatch.ts',
    'apps/web/src/app/api/payments/webhook/route.ts',
    // Airtime and IMEI paths governed by the "delivered means owed" rule.
    'apps/web/src/app/api/vtu/checkout/confirm/route.ts',
    'apps/web/src/app/api/cron/reconcile-vtu-processing/route.ts',
    'apps/web/src/lib/vtu-fulfillment-refund.ts',
    'apps/web/src/lib/vtufulfillment.ts',
    'apps/web/src/lib/imei-lookup-fulfillment/refund.ts',
    'apps/web/src/app/api/storefront/imei-check/execute-imei-lookup.ts',
    'apps/web/src/app/api/storefront/imei-check/route-cache-helpers.ts',
    // Payment confirmation, refunds, payouts and providers.
    'apps/web/src/lib/payments/confirm-paystack-dva-by-order-account.ts',
    'apps/web/src/app/api/payments/juicyway/webhook/route.ts',
    'apps/mobile-admin/hooks/usePayouts.ts',
    'apps/mobile-admin/lib/order-payment-summary.ts',
    'apps/mobile-storefront/hooks/use-redeem-points.ts',
    // Prefunded-card, primary-wallet and goal runtime, at any depth and in
    // either spelling.
    'apps/web/src/scripts/run-prefunded-card-background.ts',
    'apps/web/src/schemas/primary-restricted-readiness.ts',
    'apps/web/src/schemas/cancel-plan.ts',
    'apps/web/src/schemas/purchase_pricing.ts',
    'tools/staging/interest_bridge/plan.py',
    'packages/shared/src/contracts/piggyvest-payment-leg-recovery.ts',
    'apps/web/tools/db/supabase-history-replay-primary-pending-sources.ts',
    // Files later PiggyVest tasks plan to add, in folders that do not exist.
    'apps/web/src/lib/wallet-pin/verify.ts',
    'vps-workers/bin/piggyvest-webhook-capture-drain',
    'new-service/src/savings-sweeper.ts',
  ]) {
    assert.ok(isMoney(path, ''), `${path} must be a money path`);
  }
});

test('SQL is judged by what its change says, and unseen SQL counts as money', () => {
  const migration =
    'supabase/migrations/20261102000000_harden_order_completion.sql';
  const touchesWallet =
    '+create or replace function public.complete_order(p uuid)\n+  update customer_wallets set held = 0;';
  assert.ok(isMoney(migration, touchesWallet));
  assert.ok(isMoney(migration, '+revoke execute on function settle_payout();'));
  // GitHub omits the diff of very large files: what changed is unknown.
  assert.ok(isMoney(migration, undefined));
  assert.ok(
    !isMoney(migration, '+create index orders_created_idx on orders (id);')
  );
});

test('documentation, images and unrelated code are not money paths', () => {
  for (const path of [
    'docs/piggyvest-staging-readiness.md',
    'apps/mobile-storefront/components/wallet/README.md',
    'public/guides/chatgpt-ads/02-successful-payment.png',
    'apps/web/src/app/page.tsx',
    'apps/web/src/components/storefront/hero.tsx',
    'apps/web/src/lib/email-templates/order-receipt.ts',
    'vps-workers/lib/provision-immutable-checkout.sh',
  ]) {
    assert.ok(!isMoney(path, ''), `${path} must not be a money path`);
  }
});

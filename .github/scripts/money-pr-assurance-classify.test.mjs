// Classification of changed text: SQL money verbs and non-SQL code whose
// added lines move money, whatever the file is called.
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRawConfig } from './money-pr-assurance.test-support.mjs';
import {
  classifyChangedFiles,
  parseAssuranceConfig,
} from './money-pr-assurance-config.mjs';

const config = parseAssuranceConfig(loadRawConfig());
const isMoney = (filename, patch, status = 'modified') =>
  classifyChangedFiles([{ filename, status, patch }], config).isMoneyPath;
const migration = 'supabase/migrations/20261102000000_add_helper.sql';

test('SQL money verbs count as whole words and identifier parts', () => {
  assert.ok(
    isMoney(
      migration,
      '+create function public.debit_merchant_balance(p uuid) returns void'
    )
  );
  assert.ok(isMoney(migration, '+alter table t add column transfer_fee int;'));
  assert.ok(isMoney(migration, '+comment on table t is $$Charges and credits$$;'));
});

test('SQL without a money word is not swept in by a substring', () => {
  for (const patch of [
    '+create function public.list_products() returns setof products',
    '+create index orders_created_idx on orders (created_at);',
    '+create function public.recalculate_discharged_widgets() returns void',
    '+alter table t add column rebalanced_tree_depth int;',
  ]) {
    assert.ok(!isMoney(migration, patch), patch);
  }
});

test('a generically named file whose added lines move money is money', () => {
  const path = 'apps/web/src/lib/order-fulfilment.ts';
  assert.ok(
    isMoney(
      path,
      "@@ -1,2 +1,3 @@\n import x from 'y';\n+await supabase.rpc('debit_merchant_balance', { id });"
    )
  );
  assert.ok(isMoney(path, "+const r = await fetch('/api/payments/charge');"));
  assert.ok(isMoney(path, "-await supabase.rpc('apply_refund', { id });"));
});

test('a generic UI file is not money', () => {
  const path = 'apps/web/src/components/storefront/hero.tsx';
  assert.ok(!isMoney(path, '+<div className="balance-sheet">Hello</div>'));
  assert.ok(!isMoney(path, "+await supabase.rpc('get_products', { id });"));
  // A money call that is only context, not changed, does not count.
  assert.ok(
    !isMoney(
      path,
      "@@ -1,2 +1,2 @@\n await supabase.rpc('debit_merchant_balance', {});\n-const a = 1;\n+const a = 2;"
    )
  );
  // Tests describe money code without running it.
  assert.ok(
    !isMoney(
      'apps/web/src/components/__tests__/hero.test.tsx',
      "+await supabase.rpc('debit_merchant_balance', {});"
    )
  );
});

test('runtime code with no returned diff fails closed; docs, images and tests do not', () => {
  const runtime = 'apps/web/src/components/storefront/hero.tsx';
  assert.ok(isMoney(runtime, null));
  assert.ok(isMoney('packages/shared/src/format.ts', undefined));
  assert.ok(isMoney('scripts/tidy.sh', null));
  assert.ok(!isMoney('docs/guide/overview.md', null));
  assert.ok(!isMoney('apps/web/public/hero.png', null));
  assert.ok(!isMoney('apps/web/src/components/hero.test.tsx', null));
  assert.ok(!isMoney('apps/web/src/components/__tests__/hero.tsx', null));
  assert.ok(!isMoney('README.md', null));
  // Outside the money-relevant roots, a missing diff is not money.
  assert.ok(!isMoney('tools/misc/tidy.ts', null));
});

test('governance coverage includes the human-readable rules', () => {
  for (const path of [
    'docs/piggyvest-change-summaries/TEMPLATE.md',
    'docs/runbooks/money-pr-assurance.md',
  ]) {
    const result = classifyChangedFiles(
      [{ filename: path, status: 'modified', patch: '+x' }],
      config
    );
    assert.ok(result.isMoneyPath, path);
    assert.deepEqual(result.governanceFiles, [path]);
  }
});

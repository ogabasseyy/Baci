import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const finalLockOrderMigration = readFileSync(
  new URL(
    '../migrations/20261127123000_identity_before_catalog_lock_order.sql',
    import.meta.url
  ),
  'utf8'
);
const finalIdentityLockMigration = readFileSync(
  new URL(
    '../migrations/20261127124000_close_timeout_identity_lock_gaps.sql',
    import.meta.url
  ),
  'utf8'
);

test('storefront locks customer identity before delegating to the catalog writer', () => {
  const wrapperStart = finalLockOrderMigration.indexOf(
    'CREATE OR REPLACE FUNCTION private.create_storefront_order('
  );
  const helperCall = finalLockOrderMigration.indexOf(
    'private.lock_storefront_order_entrypoint_identity(',
    wrapperStart
  );
  const uncheckedCall = finalLockOrderMigration.indexOf(
    'private.create_storefront_order_unchecked(',
    wrapperStart
  );

  assert.notEqual(wrapperStart, -1);
  assert.ok(helperCall > wrapperStart);
  assert.ok(uncheckedCall > helperCall);
});

test('reinstatement locks customer identity before product and variant rows', () => {
  const recoveryStart = finalLockOrderMigration.indexOf(
    'CREATE OR REPLACE FUNCTION public.reinstate_timeout_order_payment('
  );
  const recovery = finalLockOrderMigration.slice(recoveryStart);
  const identityLock = recovery.indexOf('private.lock_order_replacement_identity(');
  const replacementOrderLock = recovery.indexOf('SELECT ARRAY(');
  const productLock = recovery.indexOf('PERFORM p.id');
  const variantLock = recovery.indexOf('PERFORM v.id');

  assert.ok(recoveryStart >= 0);
  assert.ok(identityLock >= 0 && replacementOrderLock > identityLock);
  assert.ok(productLock > replacementOrderLock);
  assert.ok(variantLock > productLock);
});

test('entrypoint and insert identity locks include customer IDs before user and email', () => {
  const helperStart = finalIdentityLockMigration.indexOf(
    'CREATE OR REPLACE FUNCTION private.lock_storefront_order_entrypoint_identity('
  );
  const helperEnd = finalIdentityLockMigration.indexOf(
    'ALTER FUNCTION private.lock_storefront_order_entrypoint_identity',
    helperStart
  );
  const helper = finalIdentityLockMigration.slice(helperStart, helperEnd);
  const phoneLock = helper.indexOf('hashtext(v_phone)');
  const customerLock = helper.indexOf("':customer:'");
  const userLock = helper.indexOf(
    "hashtextextended(p_merchant_id::text || ':' || v_user_id::text, 0)"
  );
  const emailLock = helper.indexOf(
    "hashtextextended(p_merchant_id::text || ':' || v_email, 1)"
  );

  assert.ok(phoneLock >= 0 && customerLock > phoneLock && userLock > customerLock && emailLock > userLock);
  assert.match(helper, /array_agg\(c\.id ORDER BY c\.id\)/);
  assert.match(
    helper,
    /CASE\s+WHEN public\.is_agentic_checkout_context\(\) THEN NULL\s+ELSE coalesce\(auth\.uid\(\), p_user_id\)\s+END/s
  );
  assert.match(helper, /lower\(c\.email\) = v_email/);
  assert.match(helper, /c\.phone = v_phone/);
});

test('replacement inserts lock guest customer IDs before user and email identities', () => {
  const helperStart = finalIdentityLockMigration.indexOf(
    'CREATE OR REPLACE FUNCTION private.lock_order_replacement_identity('
  );
  const helperEnd = finalIdentityLockMigration.indexOf(
    'ALTER FUNCTION private.lock_order_replacement_identity',
    helperStart
  );
  const helper = finalIdentityLockMigration.slice(helperStart, helperEnd);
  const customerLock = helper.indexOf("':customer:'");
  const userLock = helper.indexOf("hashtextextended(p_merchant_id::text || ':' || v_user_id::text, 0)");
  const emailLock = helper.indexOf("hashtextextended(p_merchant_id::text || ':' || v_email, 1)");
  assert.ok(customerLock >= 0 && userLock > customerLock && emailLock > userLock);
  assert.match(helper, /IF p_customer_id IS NOT NULL THEN/);
});

test('authenticated callers that omit p_user_id skip guest identity confirmation', () => {
  assert.match(
    finalLockOrderMigration,
    /IF public\.is_agentic_checkout_context\(\)\s+OR \(auth\.uid\(\) IS NULL AND p_user_id IS NULL\) THEN/s
  );
  assert.match(
    finalLockOrderMigration,
    /public\.is_agentic_checkout_context\(\) THEN NULL/
  );
});

test('guest phone prelock ignores registered customers before email fallback', () => {
  assert.equal(
    (finalLockOrderMigration.match(/AND c\.user_id IS NULL/g) ?? []).length,
    2
  );
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL(
    '../migrations/20261124090000_prelock_storefront_customer_identity.sql',
    import.meta.url
  ),
  'utf8'
);

test('storefront resolves and locks guest customer identity before checkout delegation', () => {
  const wrapperStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION private.create_storefront_order('
  );
  const helperCall = migration.indexOf(
    'private.lock_storefront_order_entrypoint_identity(',
    wrapperStart
  );
  const uncheckedCall = migration.indexOf(
    'private.create_storefront_order_unchecked(',
    wrapperStart
  );

  assert.notEqual(wrapperStart, -1);
  assert.ok(helperCall > wrapperStart);
  assert.ok(uncheckedCall > helperCall);
});

test('entrypoint identity locks follow phone, user, then email order', () => {
  const helperStart = migration.indexOf(
    'CREATE OR REPLACE FUNCTION private.lock_storefront_order_entrypoint_identity('
  );
  const helperEnd = migration.indexOf(
    'ALTER FUNCTION private.lock_storefront_order_entrypoint_identity',
    helperStart
  );
  const helper = migration.slice(helperStart, helperEnd);
  const phoneLock = helper.indexOf('hashtext(v_phone)');
  const userLock = helper.indexOf(
    "hashtextextended(p_merchant_id::text || ':' || v_user_id::text, 0)"
  );
  const emailLock = helper.indexOf(
    "hashtextextended(p_merchant_id::text || ':' || v_email, 1)"
  );

  assert.ok(phoneLock >= 0 && userLock > phoneLock && emailLock > userLock);
  assert.match(helper, /coalesce\(auth\.uid\(\), p_user_id\)/);
  assert.match(helper, /lower\(c\.email\) = v_email/);
  assert.match(helper, /c\.phone = v_phone/);
});

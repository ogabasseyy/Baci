import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkEngineOwnership,
  parseOwnershipManifest,
} from './piggyvest-hook-ownership.mjs';
import {
  DECLARATION,
  declared,
  MANIFEST,
  stub,
  withFixture,
} from './piggyvest-hook-ownership.test-support.mjs';

test('the repository migrations satisfy the ownership manifest', () => {
  const repo = (path) => new URL(`../../${path}`, import.meta.url).pathname;
  const errors = checkEngineOwnership({
    migrationsDir: repo('supabase/migrations'),
    manifestPath: repo('supabase/tests/piggyvest_hook_ownership.inc.sql'),
  });
  assert.deepEqual(errors, []);
});

test('a declaration followed by an owner replacement passes', () => {
  withFixture(
    {
      ...declared,
      '20261101000000_checkout_collect.sql': `-- piggyvest-engine-owner: P6-checkout-collect-outcome\n${stub('on_collect_confirmed_checkout').replace('CREATE', 'CREATE OR REPLACE')}`,
    },
    (errors) => assert.deepEqual(errors, [])
  );
});

test('a non-owner redefinition fails', () => {
  withFixture(
    {
      ...declared,
      '20261101000000_other.sql': `-- piggyvest-engine-owner: P7-goal-refund-settle\n${stub('on_collect_confirmed_checkout').replace('CREATE', 'CREATE OR REPLACE')}`,
    },
    (errors) => {
      assert.equal(errors.length, 1);
      assert.match(
        errors[0],
        /20261101000000_other\.sql: on_collect_confirmed_checkout .*P6-checkout-collect-outcome/
      );
    }
  );
});

test('a hook owned by nobody, or a dispatcher, stays where it was declared', () => {
  for (const [name, owner, expected] of [
    ['on_collect_confirmed_vtu', 'none', /on_collect_confirmed_vtu/],
    ['on_settled_collect', 'P6-checkout-collect-outcome', /on_settled_collect is an engine dispatcher/],
  ]) {
    const redefinition = stub(name).replace('CREATE', 'CREATE OR REPLACE');
    withFixture(
      { ...declared, '20261101000000_redefine.sql': `-- piggyvest-engine-owner: ${owner}\n${redefinition}` },
      (errors) => assert.match(errors.join('\n'), expected)
    );
  }
});

test('the declaration itself needs the engine marker', () => {
  withFixture(
    { '20261031221235_engine_hooks.sql': DECLARATION.replace(/^-- piggyvest-engine-owner.*\n/, '') },
    (errors) => assert.ok(errors.length >= 1)
  );
});

test('settle_attempt is defined once, by its owner', () => {
  const settle = `CREATE FUNCTION piggyvest_primary.settle_attempt(p uuid) RETURNS text LANGUAGE plpgsql AS $$ BEGIN RETURN 'x'; END $$;\n`;
  withFixture(
    { ...declared, '20261101000000_settle.sql': `-- piggyvest-engine-owner: P5-transfer-settle\n${settle}` },
    (errors) => assert.deepEqual(errors, [])
  );
  withFixture(
    { ...declared, '20261101000000_settle.sql': `-- piggyvest-engine-owner: P5-transfer-fail-attempts\n${settle}` },
    (errors) => assert.match(errors.join('\n'), /settle_attempt/)
  );
  withFixture(
    {
      ...declared,
      '20261101000000_settle.sql': `-- piggyvest-engine-owner: P5-transfer-settle\n${settle}`,
      '20261102000000_settle_again.sql': `-- piggyvest-engine-owner: P5-transfer-settle\n${settle.replace('CREATE', 'CREATE OR REPLACE')}`,
    },
    (errors) => {
      assert.equal(errors.length, 1);
      assert.match(errors[0], /20261102000000_settle_again\.sql: settle_attempt is defined once/);
    }
  );
});

test('a hook body that touches the wallet tables or the B writer fails, even for the owner', () => {
  for (const body of [
    "EXECUTE 'UPDATE public.' || 'customer_' || 'wallets SET available_balance = 0'",
    'UPDATE public.customer_wallets SET available_balance = 0',
    'INSERT INTO public.customer_wallet_transactions(id) VALUES (NULL)',
    'UPDATE piggyvest_primary.transfer_b_effects SET state = $$applied$$',
    'PERFORM piggyvest_primary.apply_b_effect(NULL, true)',
  ]) {
    withFixture(
      {
        ...declared,
        '20261101000000_checkout_collect.sql': `-- piggyvest-engine-owner: P6-checkout-collect-outcome
CREATE OR REPLACE FUNCTION piggyvest_primary.on_collect_confirmed_checkout(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  ${body};
  RETURN 'done';
END $fn$;
`,
      },
      (errors) => assert.match(errors.join('\n'), /on_collect_confirmed_checkout .*touches/, body)
    );
  }
});

test('a hook body that is not dollar-quoted fails closed', () => {
  withFixture(
    {
      ...declared,
      '20261101000000_quoted.sql': `-- piggyvest-engine-owner: P6-checkout-collect-outcome
CREATE OR REPLACE FUNCTION piggyvest_primary.on_collect_confirmed_checkout(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE plpgsql AS 'BEGIN PERFORM 1; RETURN ''done''; END';
`,
    },
    (errors) => assert.match(errors.join('\n'), /not dollar-quoted/)
  );
});

test('a hook may request a B effect', () => {
  withFixture(
    {
      ...declared,
      '20261101000000_checkout_collect.sql': `-- piggyvest-engine-owner: P6-checkout-collect-outcome
CREATE OR REPLACE FUNCTION piggyvest_primary.on_collect_confirmed_checkout(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  RETURN piggyvest_primary.request_b_effect(p_transfer_id, 'release_credit', 1);
END $$;
`,
    },
    (errors) => assert.deepEqual(errors, [])
  );
});

test('altering or dropping an engine function needs its owner', () => {
  for (const statement of [
    'ALTER FUNCTION piggyvest_primary.on_collect_confirmed_checkout(uuid, uuid) SECURITY INVOKER;',
    'DROP FUNCTION IF EXISTS public.unrelated(), piggyvest_primary.on_collect_confirmed_checkout(uuid, uuid);',
    'ALTER FUNCTION "piggyvest_primary"."request_b_effect"(uuid) OWNER TO service_role;',
    'ALTER FUNCTION piggyvest_primary.request_b_effect SECURITY INVOKER;',
    'DROP ROUTINE piggyvest_primary.on_collect_confirmed_checkout;',
  ]) {
    withFixture(
      { ...declared, '20261101000000_alter.sql': `-- piggyvest-engine-owner: P9-store-release-gate\n${statement}\n` },
      (errors) => assert.equal(errors.length, 1, statement)
    );
  }
});

test('a bare (unqualified) redefinition is still an engine redefinition', () => {
  withFixture(
    {
      ...declared,
      '20261101000000_bare.sql': `-- piggyvest-engine-owner: P7-goal-refund-settle
SET search_path = piggyvest_primary;
CREATE OR REPLACE FUNCTION on_collect_confirmed_checkout(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE sql AS $$ SELECT 'x'::text $$;
`,
    },
    (errors) => assert.match(errors.join('\n'), /on_collect_confirmed_checkout may only be changed by P6/)
  );
  withFixture(
    {
      ...declared,
      '20261101000000_public.sql': `CREATE FUNCTION public.on_collect_confirmed_checkout(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'x'::text $$;\n`,
    },
    (errors) => assert.deepEqual(errors, [])
  );
});

test('a hook owner may not hide a wallet write in a new helper', () => {
  const helper = `CREATE FUNCTION piggyvest_primary.checkout_helper(p uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.customer_wallets SET available_balance = 0 WHERE false;
END $$;
`;
  withFixture(
    {
      ...declared,
      '20261101000000_helper.sql': `-- piggyvest-engine-owner: P6-checkout-collect-outcome\n${helper}`,
    },
    (errors) => assert.match(errors.join('\n'), /checkout_helper touches customer_wallets in an engine owner migration/)
  );
  withFixture(
    { ...declared, '20261101000000_unrelated.sql': helper },
    (errors) => assert.deepEqual(errors, [])
  );
});

test('dynamic DDL on engine functions fails', () => {
  withFixture(
    {
      ...declared,
      '20261101000000_dynamic.sql': `DO $$ BEGIN
  EXECUTE format('CREATE OR REPLACE FUNCTION %I.%I() RETURNS text LANGUAGE sql AS ''SELECT 1''', 'piggyvest_primary', 'on_collect_confirmed_vtu');
END $$;\n`,
    },
    (errors) => assert.match(errors.join('\n'), /dynamic/)
  );
});

test('a new hook must be listed in the manifest', () => {
  withFixture(
    {
      ...declared,
      '20261101000000_new_hook.sql': `-- piggyvest-engine-owner: P5-engine-schema\n${stub('on_settled_new_kind')}`,
    },
    (errors) => assert.match(errors.join('\n'), /on_settled_new_kind .*manifest/)
  );
});

test('a comment that mentions a redefinition is ignored', () => {
  withFixture(
    {
      ...declared,
      '20261101000000_note.sql': '-- CREATE OR REPLACE FUNCTION piggyvest_primary.on_collect_confirmed_vtu() is not allowed\nSELECT 1;\n',
    },
    (errors) => assert.deepEqual(errors, [])
  );
});

test('a declared function missing from the migrations fails', () => {
  withFixture(
    { '20261031221235_engine_hooks.sql': DECLARATION.replace(stub('on_collect_confirmed_vtu'), '') },
    (errors) => assert.match(errors.join('\n'), /on_collect_confirmed_vtu is never declared/)
  );
});

test('a malformed or empty manifest fails loudly', () => {
  assert.throws(() => parseOwnershipManifest('SELECT 1;\n'), /no rows/);
  assert.throws(
    () => parseOwnershipManifest(`${MANIFEST}  ('on_failed_x', 'P1', 'shared'),\n`),
    /malformed/
  );
  assert.throws(
    () => parseOwnershipManifest(`${MANIFEST}  ('settle_attempt', 'P5-transfer-settle', 'define_once');\n`),
    /twice/
  );
});

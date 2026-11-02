// Identifier case and hook naming in the PiggyVest engine ownership check.
import assert from 'node:assert/strict';
import test from 'node:test';
import { declared, stub, withFixture } from './piggyvest-hook-ownership.test-support.mjs';

test('unquoted identifiers are case-insensitive, as in PostgreSQL', () => {
  withFixture(
    {
      ...declared,
      '20261101000000_upper.sql': `CREATE OR REPLACE FUNCTION PIGGYVEST_PRIMARY.ON_COLLECT_CONFIRMED_VTU(p_transfer_id uuid, p_attempt_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  UPDATE public.customer_wallets SET available_balance = available_balance + 1000;
  RETURN 'noop';
END $$;
DROP FUNCTION IF EXISTS piggyvest_primary.Request_B_Effect(uuid, text, bigint);
`,
    },
    (errors) => {
      const text = errors.join('\n');
      assert.match(text, /on_collect_confirmed_vtu may only be changed by none/);
      assert.match(text, /on_collect_confirmed_vtu touches customer_wallets/);
      assert.match(text, /request_b_effect may only be changed by P5-engine-schema/);
    }
  );
  withFixture(
    {
      ...declared,
      '20261101000000_upper_hook.sql': `-- piggyvest-engine-owner: P5-engine-schema\n${stub('ON_SETTLED_NEW_KIND')}`,
    },
    (errors) => assert.match(errors.join('\n'), /on_settled_new_kind .*manifest/)
  );
  withFixture(
    {
      ...declared,
      '20261101000000_upper_dynamic.sql': `DO $$ BEGIN
  EXECUTE 'CREATE OR REPLACE FUNCTION PIGGYVEST_PRIMARY.ON_COLLECT_CONFIRMED_VTU() RETURNS text LANGUAGE sql AS ''SELECT 1''';
END $$;\n`,
    },
    (errors) => assert.match(errors.join('\n'), /dynamic/)
  );
});

test('every hook-shaped name must be in the manifest', () => {
  for (const name of ['on_collect_confirmed_new', 'on_refund_settled']) {
    withFixture(
      { ...declared, '20261101000000_new_hook.sql': `-- piggyvest-engine-owner: P5-engine-schema\n${stub(name)}` },
      (errors) => assert.match(errors.join('\n'), new RegExp(`${name} .*manifest`))
    );
  }
});

test('redefining a dispatcher points the owner at its sub-hooks', () => {
  withFixture(
    {
      ...declared,
      '20261101000000_dispatcher.sql': `-- piggyvest-engine-owner: P6-checkout-collect-outcome\n${stub('on_settled_collect').replace('CREATE', 'CREATE OR REPLACE')}`,
    },
    (errors) => assert.match(errors.join('\n'), /on_settled_collect is an engine dispatcher; implement the per-purpose sub-hook/)
  );
});

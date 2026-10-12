import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryDynamicDdl } from './serialized_variant_inventory_concurrency_contract_dynamic_ddl.mjs';

const { hasDynamicPrivilegeDdl } = serializedInventoryDynamicDdl;
const signature = 'private.fixture(uuid)';

test('does not flag an unrelated literal function with an identifier-formatted grantee', () => {
  const source = `DO $$ BEGIN
    EXECUTE format('REVOKE ALL ON FUNCTION public.piggyvest_fixture(text) FROM %I', restricted_role);
  END $$;`;

  assert.equal(hasDynamicPrivilegeDdl(source, signature), false);
  assert.equal(
    hasDynamicPrivilegeDdl(source, 'public.piggyvest_fixture(text)'),
    true
  );
});

test('traces an unrelated literal privilege target assigned before execution', () => {
  const source = `DO $$ DECLARE statement text; BEGIN
    statement := format('GRANT EXECUTE ON FUNCTION public.piggyvest_fixture(text) TO %I', restricted_role);
    EXECUTE statement;
  END $$;`;

  assert.equal(hasDynamicPrivilegeDdl(source, signature), false);
});

test('still fails closed when the function or schema target is unresolved', () => {
  for (const template of [
    'GRANT EXECUTE ON FUNCTION %I(uuid) TO authenticated',
    'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO authenticated',
  ]) {
    const source = `DO $$ BEGIN EXECUTE format('${template}', target); END $$;`;
    assert.equal(hasDynamicPrivilegeDdl(source, signature), true);
  }
});

test('still fails closed when a raw formatted argument can change the privilege statement', () => {
  const source = `DO $$ BEGIN
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.piggyvest_fixture(text) TO %s', recipient);
  END $$;`;

  assert.equal(hasDynamicPrivilegeDdl(source, signature), true);
});

test('still fails closed for multiple privilege statements with an unresolved target', () => {
  const source = `DO $$ BEGIN
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.piggyvest_fixture(text) TO authenticated; GRANT EXECUTE ON FUNCTION %I(uuid) TO authenticated', target);
  END $$;`;

  assert.equal(hasDynamicPrivilegeDdl(source, signature), true);
});

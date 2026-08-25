import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryPrivileges } from './serialized_variant_inventory_concurrency_contract_privileges.mjs';

const migrationSql = serializedInventoryContract
  .migrationFileNames()
  .map((file) =>
    fs.readFileSync(
      path.join(serializedInventoryContract.migrationsDir, file),
      'utf8'
    )
  )
  .join('\n');

const privateFunctions = [
  'private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)',
  'private.confirm_order_inventory_reservations(uuid, uuid)',
];
const publicFunctions = [
  'public.claim_variant_inventory_units_for_order_item(uuid, uuid, uuid)',
  'public.confirm_order_inventory_reservations(uuid, uuid)',
];
const releaseFunctions = [
  ['public.release_order_inventory_units(uuid, uuid, text)', 'invoker'],
  ['private.release_order_inventory_units(uuid, uuid, text)', 'definer'],
];

test('private inventory functions remain inaccessible to authenticated callers', () => {
  for (const signature of privateFunctions) {
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        migrationSql,
        signature
      ),
      false
    );
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        `${migrationSql}\nGRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC;`,
        signature
      ),
      true
    );
  }
});

test('public inventory wrappers stay executable and security definer', () => {
  for (const signature of publicFunctions) {
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        migrationSql,
        signature
      ),
      true
    );
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        `${migrationSql}\nREVOKE ALL ON FUNCTION ${signature} FROM authenticated;`,
        signature
      ),
      false
    );
    assert.equal(
      serializedInventoryPrivileges.effectiveSecurityMode(
        migrationSql,
        signature
      ),
      'definer'
    );
    assert.equal(
      serializedInventoryPrivileges.effectiveSecurityMode(
        `${migrationSql}\nALTER FUNCTION ${signature} SECURITY INVOKER;`,
        signature
      ),
      'invoker'
    );
  }
});

test('later function definitions replace earlier security alterations', () => {
  const signature = 'public.fixture(uuid)';
  const source = `
    CREATE FUNCTION public.fixture(p_id uuid) RETURNS void
      SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    ALTER FUNCTION public.fixture(uuid) SECURITY INVOKER;
    CREATE OR REPLACE FUNCTION public.fixture(p_id uuid) RETURNS void
      SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
  `;
  assert.equal(
    serializedInventoryPrivileges.effectiveSecurityMode(source, signature),
    'definer'
  );
});

test('release wrapper and delegate remain executable by authenticated callers', () => {
  for (const [signature, mode] of releaseFunctions) {
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        migrationSql,
        signature
      ),
      true
    );
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        `${migrationSql}\nREVOKE ALL ON FUNCTION ${signature} FROM authenticated;`,
        signature
      ),
      false
    );
    assert.equal(
      serializedInventoryPrivileges.effectiveSecurityMode(
        migrationSql,
        signature
      ),
      mode
    );
  }
});

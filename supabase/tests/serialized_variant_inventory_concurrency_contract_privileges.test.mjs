import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryPrivileges } from './serialized_variant_inventory_concurrency_contract_privileges.mjs';

const migrationSources = serializedInventoryContract
  .migrationFileNames()
  .map((file) =>
    fs.readFileSync(
      path.join(serializedInventoryContract.migrationsDir, file),
      'utf8'
    )
  );
const migrationSql = migrationSources.join('\n');

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
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        `${migrationSql}
          GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC;
          SELECT 'REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;';`,
        signature
      ),
      true
    );
  }
});

test('freshly recreated private functions regain the default PUBLIC grant', () => {
  const signature = privateFunctions[0];
  const recreated = `${migrationSql}
    DROP FUNCTION ${signature};
    CREATE FUNCTION private.claim_variant_inventory_units_for_order_item_internal(
      p_merchant_id uuid,
      p_order_id uuid,
      p_order_item_id uuid
    ) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
  `;
  assert.equal(
    serializedInventoryPrivileges.authenticatedCanExecute(recreated, signature),
    true
  );
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
        migrationSources,
        signature
      ),
      'definer'
    );
    assert.equal(
      serializedInventoryPrivileges.effectiveSecurityMode(
        [...migrationSources, `ALTER FUNCTION ${signature} SECURITY INVOKER;`],
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
        migrationSources,
        signature
      ),
      mode
    );
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryPrivileges } from './serialized_variant_inventory_concurrency_contract_privileges.mjs';

const migrationSources = serializedInventoryContract.migrationSources;
const authSources = (...append) => [...migrationSources, ...append];

const releaseFunctions = [
  ['public.release_order_inventory_units(uuid, uuid, text)', 'definer'],
  ['private.release_order_inventory_units(uuid, uuid, text)', 'definer'],
];

test('release wrapper and delegate remain executable by authenticated callers', () => {
  for (const [signature, mode] of releaseFunctions) {
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        migrationSources,
        signature
      ),
      true
    );
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        authSources(`REVOKE ALL ON FUNCTION ${signature} FROM authenticated;`),
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
    assert.equal(
      serializedInventoryPrivileges.effectiveSecurityMode(
        [...migrationSources, `ALTER FUNCTION ${signature} SECURITY INVOKER;`],
        signature
      ),
      'invoker'
    );
    if (signature.startsWith('public.')) {
      const releaseSourceIndex = migrationSources.findIndex((source) =>
        source.includes(
          'CREATE OR REPLACE FUNCTION public.release_order_inventory_units'
        )
      );
      assert.notEqual(releaseSourceIndex, -1);
      const nonDelegatingSources = migrationSources.map((source, index) =>
        index === releaseSourceIndex
          ? source.replace(
              /RETURN\s+private\.release_order_inventory_units\(/i,
              'RETURN jsonb_build_object('
            )
          : source
      );
      assert.equal(
        serializedInventoryPrivileges.effectiveSecurityMode(
          nonDelegatingSources,
          signature
        ),
        'invoker'
      );
    }
  }
});

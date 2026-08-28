import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryPrivileges } from './serialized_variant_inventory_concurrency_contract_privileges.mjs';

const migrationSources = serializedInventoryContract.migrationSources;
const authSources = (...append) => [...migrationSources, ...append];

const privateFunctions = [
  'private.claim_variant_inventory_units_for_order_item_internal(uuid, uuid, uuid)',
  'private.confirm_order_inventory_reservations(uuid, uuid)',
];
const publicFunctions = [
  'public.claim_variant_inventory_units_for_order_item(uuid, uuid, uuid)',
  'public.confirm_order_inventory_reservations(uuid, uuid)',
];
const releaseFunctions = [
  ['public.release_order_inventory_units(uuid, uuid, text)', 'definer'],
  ['private.release_order_inventory_units(uuid, uuid, text)', 'definer'],
];

test('private inventory functions remain inaccessible to authenticated callers', () => {
  for (const signature of privateFunctions) {
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        migrationSources,
        signature
      ),
      false
    );
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        authSources(`GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC;`),
        signature
      ),
      true
    );
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        authSources(
          `GRANT EXECUTE ON FUNCTION ${signature} TO PUBLIC;
          SELECT 'REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;';`
        ),
        signature
      ),
      true
    );
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        authSources(`GRANT ALL PRIVILEGES ON FUNCTION ${signature} TO PUBLIC;`),
        signature
      ),
      true
    );
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        authSources(
          `GRANT EXECUTE ON FUNCTION private.other(uuid), ${signature} TO PUBLIC;`
        ),
        signature
      ),
      true
    );
    assert.equal(
      serializedInventoryPrivileges.authenticatedCanExecute(
        authSources(
          'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private TO authenticated;'
        ),
        signature
      ),
      true
    );
  }
});

test('freshly recreated private functions regain the default PUBLIC grant', () => {
  const signature = privateFunctions[0];
  const recreated = authSources(`
    DROP FUNCTION ${signature};
    CREATE FUNCTION private.claim_variant_inventory_units_for_order_item_internal(
      p_merchant_id uuid,
      p_order_id uuid,
      p_order_item_id uuid
    ) RETURNS jsonb LANGUAGE sql SECURITY DEFINER AS $$ SELECT '{}'::jsonb $$;
  `);
  assert.equal(
    serializedInventoryPrivileges.authenticatedCanExecute(recreated, signature),
    true
  );
});

test('private function grants inherited through authenticated roles remain detectable', () => {
  const signature = privateFunctions[0];
  const inherited = authSources(`
    GRANT EXECUTE ON FUNCTION ${signature} TO inventory_delegate;
    GRANT inventory_delegate TO authenticated;
  `);
  assert.equal(
    serializedInventoryPrivileges.authenticatedCanExecute(inherited, signature),
    true
  );
  assert.equal(
    serializedInventoryPrivileges.authenticatedCanExecute(
      [
        ...inherited,
        `
        REVOKE inventory_delegate FROM authenticated;`,
      ],
      signature
    ),
    false
  );
});

test('public inventory wrappers stay executable and security definer', () => {
  for (const signature of publicFunctions) {
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
      'definer'
    );
    assert.equal(
      serializedInventoryPrivileges.effectiveSecurityMode(
        [...migrationSources, `ALTER FUNCTION ${signature} SECURITY INVOKER;`],
        signature
      ),
      'invoker'
    );
    assert.equal(
      serializedInventoryPrivileges.effectiveSecurityMode(
        [
          ...migrationSources,
          `ALTER FUNCTION ${signature} SECURITY INVOKER;
           SELECT 'ALTER FUNCTION ${signature} SECURITY DEFINER;';`,
        ],
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

test('recognizes ROUTINE privilege and security syntax', () => {
  const privateSignature = 'private.fixture(uuid)';
  const privateSource = `
    CREATE FUNCTION ${privateSignature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${privateSignature} FROM PUBLIC;
    GRANT EXECUTE ON ROUTINE ${privateSignature} TO PUBLIC;
  `;
  assert.equal(
    serializedInventoryPrivileges.authenticatedCanExecute(
      privateSource,
      privateSignature
    ),
    true
  );

  const publicSignature = 'public.fixture(uuid)';
  const publicSource = `
    CREATE FUNCTION ${publicSignature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    ALTER ROUTINE ${publicSignature} SECURITY INVOKER;
  `;
  assert.equal(
    serializedInventoryPrivileges.effectiveSecurityMode(
      publicSource,
      publicSignature
    ),
    'invoker'
  );
  assert.equal(
    serializedInventoryPrivileges.effectiveSecurityMode(
      publicSource.replace(
        'ALTER ROUTINE public.fixture(uuid) SECURITY INVOKER;',
        'ALTER FUNCTION "public"."fixture"(uuid) SECURITY INVOKER;'
      ),
      publicSignature
    ),
    'invoker'
  );
});

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

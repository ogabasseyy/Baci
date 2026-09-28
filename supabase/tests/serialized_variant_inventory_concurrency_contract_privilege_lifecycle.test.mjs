import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryPrivilegeExecution } from './serialized_variant_inventory_concurrency_contract_privilege_execution.mjs';
import { serializedInventoryPrivilegeLifecycle } from './serialized_variant_inventory_concurrency_contract_privilege_lifecycle.mjs';

const { functionLifecycleEvents } = serializedInventoryPrivilegeLifecycle;

test('tracks create, replacement, drop, and ownership lifecycle events', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void AS $$ BEGIN NULL; END; $$;
    CREATE OR REPLACE FUNCTION ${signature} RETURNS void AS $$ BEGIN NULL; END; $$;
    ALTER ROUTINE ${signature} OWNER TO authenticated;
    DROP FUNCTION private.other(uuid), ${signature} RESTRICT;
  `;

  assert.deepEqual(
    functionLifecycleEvents(source, signature).map(
      ({ kind, replace, owner }) => ({
        kind,
        ...(replace === undefined ? {} : { replace }),
        ...(owner === undefined ? {} : { owner }),
      })
    ),
    [
      { kind: 'create', replace: false },
      { kind: 'create', replace: true },
      { kind: 'owner', owner: 'authenticated' },
      { kind: 'drop' },
    ]
  );
});

test('ignores malformed signatures and unrelated lifecycle statements', () => {
  assert.deepEqual(
    functionLifecycleEvents(
      'CREATE FUNCTION private.fixture;',
      'private.fixture'
    ),
    []
  );
  assert.deepEqual(
    functionLifecycleEvents(
      'CREATE FUNCTION private.other(uuid) RETURNS void AS $$ BEGIN NULL; END; $$;',
      'private.fixture(uuid)'
    ),
    []
  );
});

test('invalidates renamed and moved functions before replacement', () => {
  const signature = 'private.fixture(uuid)';
  for (const alteration of [
    'ALTER FUNCTION private.fixture(uuid) RENAME TO fixture_renamed;',
    'ALTER ROUTINE private.fixture(uuid) SET SCHEMA archived;',
  ]) {
    const source = `
      CREATE FUNCTION ${signature} RETURNS void AS $$ BEGIN NULL; END; $$;
      REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
      ${alteration}
      CREATE OR REPLACE FUNCTION ${signature} RETURNS void AS $$ BEGIN NULL; END; $$;
    `;
    assert.deepEqual(
      functionLifecycleEvents(source, signature).map(({ kind }) => kind),
      ['create', 'invalidate', 'create']
    );
    assert.equal(
      serializedInventoryPrivilegeExecution.authenticatedCanExecute(
        source,
        signature
      ),
      true
    );
  }
});

test('tracks REASSIGN OWNED transfers from the current function owner', () => {
  const signature = 'private.fixture(uuid)';
  const source = `
    CREATE FUNCTION ${signature} RETURNS void AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
    ALTER FUNCTION ${signature} OWNER TO inventory_owner;
    REASSIGN OWNED BY inventory_owner TO authenticated;
  `;

  assert.deepEqual(
    functionLifecycleEvents(source, signature).map(({ kind, owner, from }) => ({
      kind,
      ...(owner === undefined ? {} : { owner }),
      ...(from === undefined ? {} : { from }),
    })),
    [
      { kind: 'create' },
      { kind: 'owner', owner: 'inventory_owner' },
      { kind: 'reassign', from: ['inventory_owner'], owner: 'authenticated' },
    ]
  );
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );

  const unrelatedReassign = source.replace(
    'REASSIGN OWNED BY inventory_owner',
    'REASSIGN OWNED BY another_owner'
  );
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      unrelatedReassign,
      signature
    ),
    false
  );
});

test('fails closed when routines move into the protected identity', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    `ALTER FUNCTION ${signature} RENAME TO fixture_retired;`,
    'SET ROLE authenticated;',
    'CREATE FUNCTION private.standby(uuid) RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    'RESET ROLE;',
    'ALTER FUNCTION private.standby(uuid) RENAME TO fixture;',
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('matches lifecycle declarations with catalog-qualified types', () => {
  const signature = 'private.fixture(uuid, uuid)';
  const source = [
    'CREATE FUNCTION private.fixture(p_a uuid, p_b uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    'DROP FUNCTION private.fixture(uuid, uuid);',
    'CREATE FUNCTION private.fixture(p_a pg_catalog.uuid, p_b pg_catalog.uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;',
    'ALTER FUNCTION private.fixture(pg_catalog.uuid, pg_catalog.uuid) OWNER TO authenticated;',
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('splits reassigned owners with quote awareness', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    `ALTER FUNCTION ${signature} OWNER TO "inventory,owner";`,
    'REASSIGN OWNED BY "inventory,owner" TO authenticated;',
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

test('parses DROP OWNED role lists with cascade and quote awareness', () => {
  const signature = 'private.fixture(uuid)';
  assert.deepEqual(
    functionLifecycleEvents(
      'DROP OWNED BY deployer, "ops,lead" CASCADE;',
      signature
    ).map(({ kind, roles }) => ({ kind, roles })),
    [{ kind: 'drop-owned', roles: ['deployer', 'ops,lead'] }]
  );
  assert.deepEqual(
    functionLifecycleEvents('DROP OWNED BY CURRENT_USER;', signature).map(
      ({ kind, roles }) => ({ kind, roles })
    ),
    [{ kind: 'drop-owned', roles: ['current_user'] }]
  );
});

test('invalidates functions owned by a dropped-owned role', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    'SET ROLE deployer;',
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`,
    'DROP OWNED BY deployer;',
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    false
  );
});

test('keeps functions owned by other roles after DROP OWNED', () => {
  const signature = 'private.fixture(uuid)';
  const source = [
    'SET ROLE deployer;',
    `CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`,
    `GRANT EXECUTE ON FUNCTION ${signature} TO authenticated;`,
    'DROP OWNED BY mallory;',
  ].join('\n');
  assert.equal(
    serializedInventoryPrivilegeExecution.authenticatedCanExecute(
      source,
      signature
    ),
    true
  );
});

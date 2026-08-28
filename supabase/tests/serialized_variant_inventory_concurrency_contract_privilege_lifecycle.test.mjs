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

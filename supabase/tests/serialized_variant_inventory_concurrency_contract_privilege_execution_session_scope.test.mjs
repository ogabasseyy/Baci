import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryPrivilegeExecution } from './serialized_variant_inventory_concurrency_contract_privilege_execution.mjs';

const { authenticatedCanExecute } = serializedInventoryPrivilegeExecution;

function ownedFunctionSource(signature, roleStatement) {
  return `
    ${roleStatement}
    CREATE FUNCTION ${signature} RETURNS void SECURITY DEFINER
      LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$;
    REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
  `;
}

test('keeps SET LOCAL role active within the same migration source', () => {
  const signature = 'private.fixture(uuid)';
  assert.equal(
    authenticatedCanExecute(
      ownedFunctionSource(signature, 'SET LOCAL ROLE authenticated;'),
      signature
    ),
    true
  );
});

test('resets SET LOCAL role at the next migration source', () => {
  const signature = 'private.fixture(uuid)';
  assert.equal(
    authenticatedCanExecute(
      [
        'SET LOCAL ROLE authenticated;',
        ownedFunctionSource(signature, 'SELECT 1;'),
      ],
      signature
    ),
    false
  );
});

test('persists session SET ROLE across migration sources', () => {
  const signature = 'private.fixture(uuid)';
  assert.equal(
    authenticatedCanExecute(
      ['SET ROLE authenticated;', ownedFunctionSource(signature, 'SELECT 1;')],
      signature
    ),
    true
  );
});

test('keeps SET LOCAL SESSION AUTHORIZATION active within the same source', () => {
  const signature = 'private.fixture(uuid)';
  assert.equal(
    authenticatedCanExecute(
      ownedFunctionSource(
        signature,
        'SET LOCAL SESSION AUTHORIZATION authenticated;'
      ),
      signature
    ),
    true
  );
});

test('resets SET LOCAL SESSION AUTHORIZATION at the next migration source', () => {
  const signature = 'private.fixture(uuid)';
  assert.equal(
    authenticatedCanExecute(
      [
        'SET LOCAL SESSION AUTHORIZATION authenticated;',
        ownedFunctionSource(signature, 'SELECT 1;'),
      ],
      signature
    ),
    false
  );
});

test('clears SET LOCAL role on RESET ROLE in the same source', () => {
  const signature = 'private.fixture(uuid)';
  assert.equal(
    authenticatedCanExecute(
      `
        SET LOCAL ROLE authenticated;
        RESET ROLE;
        ${ownedFunctionSource(signature, 'SELECT 1;')}
      `,
      signature
    ),
    false
  );
});

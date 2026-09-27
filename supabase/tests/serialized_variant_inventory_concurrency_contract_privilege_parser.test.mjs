import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryPrivilegeParser } from './serialized_variant_inventory_concurrency_contract_privilege_parser.mjs';

test('removes grant options and grantor clauses from function grantees', () => {
  const parsed = serializedInventoryPrivilegeParser.parseFunctionPrivilege(
    'GRANT EXECUTE ON FUNCTION private.fixture(uuid) TO authenticated WITH GRANT OPTION GRANTED BY postgres;'
  );

  assert.deepEqual(
    {
      functionList: parsed?.functionList,
      grantees: parsed?.grantees,
      operation: parsed?.operation,
    },
    {
      functionList: 'private.fixture(uuid)',
      grantees: 'authenticated',
      operation: 'GRANT',
    }
  );
});

test('drops grantor-qualified revokes to preserve other grantors', () => {
  assert.equal(
    serializedInventoryPrivilegeParser.parseFunctionPrivilege(
      'REVOKE EXECUTE ON FUNCTION private.fixture(uuid) FROM authenticated GRANTED BY postgres;'
    ),
    null
  );
  assert.notEqual(
    serializedInventoryPrivilegeParser.parseFunctionPrivilege(
      'REVOKE EXECUTE ON FUNCTION private.fixture(uuid) FROM authenticated;'
    ),
    null
  );
});

test('matches unqualified privilege targets against the signature', () => {
  const target = new RegExp(
    `^${serializedInventoryPrivilegeParser.privilegeTargetPattern('private.fixture(uuid)')}$`,
    'i'
  );
  assert.equal(target.test('private.fixture(uuid)'), true);
  assert.equal(target.test('fixture(uuid)'), true);
  assert.equal(target.test('public.fixture(uuid)'), false);
});

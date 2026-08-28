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

import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryPrivilegeRoles } from './serialized_variant_inventory_concurrency_contract_privilege_roles.mjs';

test('resolves inherited function privileges through role membership', () => {
  const membership = serializedInventoryPrivilegeRoles.parseRoleMembership(
    'GRANT inventory_delegate TO authenticated;'
  );
  assert.deepEqual(membership?.roles, ['inventory_delegate']);
  assert.deepEqual(membership?.members, ['authenticated']);
  const memberships = new Map([['authenticated', ['inventory_delegate']]]);
  const grants = new Map([['inventory_delegate', true]]);
  assert.equal(
    serializedInventoryPrivilegeRoles.canExecuteAs(
      'authenticated',
      grants,
      memberships
    ),
    true
  );
});

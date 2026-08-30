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

test('parses default function privileges for every schema in a comma-separated list', () => {
  const privileges =
    serializedInventoryPrivilegeRoles.parseDefaultFunctionPrivileges(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, private GRANT EXECUTE ON FUNCTIONS TO authenticated;',
      'private'
    );

  assert.deepEqual(privileges, [
    {
      grantees: 'authenticated',
      index: 0,
      kind: 'default',
      operation: 'GRANT',
      owner: 'postgres',
    },
  ]);
});

test('parses session role changes for privilege lifecycle analysis', () => {
  assert.deepEqual(
    serializedInventoryPrivilegeRoles.parseRoleChange(
      '  SET ROLE "authenticated";'
    ),
    { index: 2, kind: 'role', role: 'authenticated' }
  );
  assert.deepEqual(
    serializedInventoryPrivilegeRoles.parseRoleChange('RESET ROLE;'),
    { index: 0, kind: 'reset-role' }
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { serializedInventoryPrivilegeRoles } from './serialized_variant_inventory_concurrency_contract_privilege_roles.mjs';

test('resolves inherited function privileges through role membership', () => {
  const membership = serializedInventoryPrivilegeRoles.parseRoleMembership(
    'GRANT inventory_delegate TO authenticated;'
  );
  assert.deepEqual(membership?.roles, ['inventory_delegate']);
  assert.deepEqual(membership?.members, ['authenticated']);
  assert.equal(membership?.inheritable, true);
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
      scope: 'schema',
    },
  ]);
});

test('parses grantor clauses and quoted names on role memberships', () => {
  const grantedBy = serializedInventoryPrivilegeRoles.parseRoleMembership(
    'GRANT inventory_delegate TO authenticated GRANTED BY postgres;'
  );
  assert.deepEqual(grantedBy?.roles, ['inventory_delegate']);
  assert.deepEqual(grantedBy?.members, ['authenticated']);
  assert.equal(grantedBy?.operation, 'GRANT');

  const quoted = serializedInventoryPrivilegeRoles.parseRoleMembership(
    'GRANT "inventory,delegate" TO authenticated;'
  );
  assert.deepEqual(quoted?.roles, ['inventory,delegate']);

  const nonInheritable = serializedInventoryPrivilegeRoles.parseRoleMembership(
    'GRANT inventory_delegate TO authenticated WITH INHERIT FALSE, SET FALSE;'
  );
  assert.equal(nonInheritable?.inheritable, false);
  assert.equal(nonInheritable?.settable, false);

  const setOnly = serializedInventoryPrivilegeRoles.parseRoleMembership(
    'GRANT inventory_delegate TO authenticated WITH INHERIT FALSE;'
  );
  assert.equal(setOnly?.inheritable, false);
  assert.equal(setOnly?.settable, true);
});

test('parses every owner in a multi-role default-privilege statement', () => {
  const privileges =
    serializedInventoryPrivilegeRoles.parseDefaultFunctionPrivileges(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres, inventory_owner IN SCHEMA private GRANT EXECUTE ON FUNCTIONS TO authenticated;',
      'private'
    );

  assert.deepEqual(
    privileges.map(({ owner, scope }) => ({ owner, scope })),
    [
      { owner: 'postgres', scope: 'schema' },
      { owner: 'inventory_owner', scope: 'schema' },
    ]
  );

  const global =
    serializedInventoryPrivilegeRoles.parseDefaultFunctionPrivileges(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO authenticated;',
      'private'
    );
  assert.deepEqual(
    global.map(({ owner, scope }) => ({ owner, scope })),
    [{ owner: 'postgres', scope: 'global' }]
  );
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
  assert.deepEqual(
    serializedInventoryPrivilegeRoles.parseRoleChange(
      'SET SESSION AUTHORIZATION authenticated;'
    ),
    {
      index: 0,
      kind: 'role',
      role: 'authenticated',
      sessionAuthorization: true,
    }
  );
  assert.deepEqual(
    serializedInventoryPrivilegeRoles.parseRoleChange(
      'RESET SESSION AUTHORIZATION;'
    ),
    { index: 0, kind: 'reset-role', sessionAuthorization: true }
  );
  assert.deepEqual(
    serializedInventoryPrivilegeRoles.parseRoleChange(
      'SET SESSION AUTHORIZATION DEFAULT;'
    ),
    { index: 0, kind: 'reset-role', sessionAuthorization: true }
  );
  assert.deepEqual(
    serializedInventoryPrivilegeRoles.parseRoleChange(
      'SET LOCAL ROLE authenticated;'
    ),
    { index: 0, kind: 'role', role: 'authenticated' }
  );
  assert.deepEqual(
    serializedInventoryPrivilegeRoles.parseRoleChange(
      'SET SESSION ROLE authenticated;'
    ),
    { index: 0, kind: 'role', role: 'authenticated' }
  );
  assert.deepEqual(
    serializedInventoryPrivilegeRoles.parseRoleChange('SET ROLE NONE;'),
    { index: 0, kind: 'reset-role' }
  );
});

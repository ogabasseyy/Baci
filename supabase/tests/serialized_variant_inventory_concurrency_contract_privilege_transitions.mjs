import { serializedInventoryPrivilegeRoles } from './serialized_variant_inventory_concurrency_contract_privilege_roles.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { splitTopLevelList } = serializedInventorySqlParser;

function resolveActiveRole(reference, state) {
  return serializedInventoryPrivilegeRoles.resolveSpecialRole(
    reference,
    state.currentRole,
    state.sessionUser
  );
}

export function createPrivilegeState() {
  return {
    activeSource: -1,
    exists: false,
    grants: new Map(),
    grantSources: new Map(),
    defaultGrants: new Map(),
    memberships: new Map(),
    membershipSources: new Map(),
    currentRole: 'postgres',
    sessionUser: 'postgres',
    localRole: null,
    owner: undefined,
  };
}

function restoreLocalRole(state) {
  if (state.localRole === null) return;
  state.currentRole = state.localRole.savedRole;
  state.sessionUser = state.localRole.savedSessionUser;
  state.localRole = null;
}

function applyRoleEvent(state, event) {
  if (event.local) {
    if (state.localRole === null) {
      state.localRole = {
        savedRole: state.currentRole,
        savedSessionUser: state.sessionUser,
      };
    }
    state.currentRole = event.role;
    if (event.sessionAuthorization) state.sessionUser = event.role;
    return;
  }
  if (state.localRole !== null) {
    state.localRole.savedRole = event.role;
    if (event.sessionAuthorization)
      state.localRole.savedSessionUser = event.role;
    return;
  }
  state.currentRole = event.role;
  if (event.sessionAuthorization) state.sessionUser = event.role;
}

function applyResetRoleEvent(state, event) {
  const local = state.localRole;
  state.localRole = null;
  if (event.sessionAuthorization) {
    state.currentRole = 'postgres';
    state.sessionUser = 'postgres';
  } else {
    state.currentRole = local?.savedSessionUser ?? state.sessionUser;
  }
}

function applyInvalidateEvent(state) {
  state.exists = false;
  state.grants.clear();
  state.grantSources.clear();
  state.owner = undefined;
}

function applyCreateEvent(state, event) {
  if (!event.replace || !state.exists) {
    state.grants.clear();
    state.grantSources.clear();
    state.grants.set('public', true);
    state.owner ??= state.currentRole;
    state.grantSources.set('public', new Set([state.owner]));
    const ownerDefaults = state.defaultGrants.get(state.owner);
    if (ownerDefaults) {
      const defaultedRoles = new Set([
        ...ownerDefaults.global.keys(),
        ...ownerDefaults.schema.keys(),
      ]);
      for (const role of defaultedRoles) {
        const defaulted =
          ownerDefaults.global.get(role) === true ||
          ownerDefaults.schema.get(role) === true;
        state.grants.set(role, defaulted);
        state.grantSources.set(
          role,
          defaulted ? new Set([state.owner]) : new Set()
        );
      }
    }
  }
  state.exists = true;
}

function applyDefaultEvent(state, event) {
  const grant = event.operation === 'GRANT';
  const owner =
    event.owner === null || event.owner === undefined
      ? state.currentRole
      : resolveActiveRole(event.owner, state);
  const ownerDefaults = state.defaultGrants.get(owner) ?? {
    global: new Map(),
    schema: new Map(),
  };
  const scope =
    event.scope === 'schema' ? ownerDefaults.schema : ownerDefaults.global;
  for (const grantee of splitTopLevelList(event.grantees)) {
    scope.set(
      resolveActiveRole(
        serializedInventoryPrivilegeRoles.normalizeRoleName(grantee),
        state
      ),
      grant
    );
  }
  state.defaultGrants.set(owner, ownerDefaults);
}

function applyMembershipEvent(state, event) {
  const usable = event.inheritable !== false || event.settable !== false;
  const grantor =
    event.grantor === undefined || event.grantor === null
      ? state.currentRole
      : resolveActiveRole(
          serializedInventoryPrivilegeRoles.normalizeRoleName(event.grantor),
          state
        );
  for (const member of event.members) {
    const resolvedMember = resolveActiveRole(member, state);
    const sources = state.membershipSources.get(resolvedMember) ?? new Map();
    for (const role of event.roles) {
      const resolvedRole = resolveActiveRole(role, state);
      const grantors = sources.get(resolvedRole) ?? new Set();
      if (event.operation === 'GRANT' && usable) grantors.add(grantor);
      else grantors.delete(grantor);
      if (grantors.size > 0) sources.set(resolvedRole, grantors);
      else sources.delete(resolvedRole);
    }
    if (sources.size > 0) {
      state.membershipSources.set(resolvedMember, sources);
      state.memberships.set(resolvedMember, [...sources.keys()]);
    } else {
      state.membershipSources.delete(resolvedMember);
      state.memberships.delete(resolvedMember);
    }
  }
}

function applyPrivilegeGrantEvent(state, event) {
  const grant = /^GRANT/i.test(event.match[0]);
  const grantees = event.grantees ?? event.match[1];
  const grantor =
    event.grantor === undefined || event.grantor === null
      ? state.currentRole
      : resolveActiveRole(
          serializedInventoryPrivilegeRoles.normalizeRoleName(event.grantor),
          state
        );
  for (const grantee of splitTopLevelList(grantees)) {
    const resolved = resolveActiveRole(
      serializedInventoryPrivilegeRoles.normalizeRoleName(grantee),
      state
    );
    const sources = state.grantSources.get(resolved) ?? new Set();
    if (grant) sources.add(grantor);
    else sources.delete(grantor);
    state.grantSources.set(resolved, sources);
    state.grants.set(resolved, sources.size > 0);
  }
}

export function applyPrivilegeEvent(state, event) {
  if (event.sourceIndex !== state.activeSource) {
    state.activeSource = event.sourceIndex;
    restoreLocalRole(state);
  }
  if (event.kind === 'role') applyRoleEvent(state, event);
  else if (event.kind === 'reset-role') applyResetRoleEvent(state, event);
  else if (event.kind === 'drop' || event.kind === 'invalidate')
    applyInvalidateEvent(state);
  else if (event.kind === 'drop-owned') {
    const references = event.roles.map((reference) =>
      resolveActiveRole(reference, state)
    );
    for (const role of references) {
      state.grants.delete(role);
      state.grantSources.delete(role);
      state.memberships.delete(role);
      state.membershipSources.delete(role);
    }
    if (state.owner === undefined || references.includes(state.owner)) {
      applyInvalidateEvent(state);
    }
  } else if (event.kind === 'create') applyCreateEvent(state, event);
  else if (event.kind === 'owner')
    state.owner = resolveActiveRole(event.owner, state);
  else if (event.kind === 'move') {
    state.exists = true;
    state.owner = 'authenticated';
  } else if (event.kind === 'reassign') {
    const references = event.from.map((reference) =>
      resolveActiveRole(reference, state)
    );
    if (state.owner !== undefined && references.includes(state.owner)) {
      state.owner = resolveActiveRole(event.owner, state);
    }
  } else if (event.kind === 'default') applyDefaultEvent(state, event);
  else if (event.kind === 'membership') applyMembershipEvent(state, event);
  else applyPrivilegeGrantEvent(state, event);
}

export const serializedInventoryPrivilegeTransitions = {
  applyPrivilegeEvent,
  createPrivilegeState,
};

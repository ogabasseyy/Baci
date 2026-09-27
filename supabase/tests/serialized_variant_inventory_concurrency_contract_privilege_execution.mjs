import { serializedInventoryDynamicDdl } from './serialized_variant_inventory_concurrency_contract_dynamic_ddl.mjs';
import { serializedInventoryPrivilegeLifecycle } from './serialized_variant_inventory_concurrency_contract_privilege_lifecycle.mjs';
import { serializedInventoryPrivilegeParser } from './serialized_variant_inventory_concurrency_contract_privilege_parser.mjs';
import { serializedInventoryPrivilegeRoles } from './serialized_variant_inventory_concurrency_contract_privilege_roles.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { parseFunctionPrivilege, privilegeTargetPattern } =
  serializedInventoryPrivilegeParser;
const { splitTopLevelList } = serializedInventorySqlParser;

function schemaNameFromSignature(signature) {
  const match = /^(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s*\./i.exec(signature);
  return (match?.[1] ?? match?.[2] ?? '').toLowerCase();
}

const maskedSourceCache = new Map();

function maskSqlStringLiterals(source) {
  const cached = maskedSourceCache.get(source);
  if (cached !== undefined) return cached;
  const masked = serializedInventorySqlParser.maskSqlLiterals(
    serializedInventorySqlParser.stripSqlComments(source)
  );
  maskedSourceCache.set(source, masked);
  return masked;
}

function splitFunctionPrivilegeTargets(source) {
  return splitTopLevelList(source);
}

const authenticatedExecutionCache = new Map();

function authenticatedCanExecute(source, signature) {
  const sources = Array.isArray(source) ? source : [source];
  if (
    sources.some((candidate) =>
      serializedInventoryDynamicDdl.hasDynamicPrivilegeDdl(candidate, signature)
    )
  ) {
    return true;
  }
  const key = `${Array.isArray(source) ? source.join('\u0001') : source}\u0000${signature}`;
  const cached = authenticatedExecutionCache.get(key);
  if (cached !== undefined) return cached;
  const result = computeAuthenticatedCanExecute(source, signature);
  authenticatedExecutionCache.set(key, result);
  return result;
}

function computeAuthenticatedCanExecute(sourceOrSources, signature) {
  const state = {
    exists: false,
    grants: new Map(),
    defaultGrants: new Map(),
    memberships: new Map(),
    currentRole: 'postgres',
    sessionUser: 'postgres',
    owner: undefined,
  };
  const executableSources = (
    Array.isArray(sourceOrSources) ? sourceOrSources : [sourceOrSources]
  ).map(maskSqlStringLiterals);
  const targetSchema = schemaNameFromSignature(signature);
  const events = executableSources
    .flatMap((executable, sourceIndex) =>
      serializedInventorySqlParser
        .splitSqlStatements(executable)
        .flatMap(({ index, text }) => {
          const lifecycle = serializedInventoryPrivilegeLifecycle
            .functionLifecycleEvents(text, signature)
            .map((event) => ({
              ...event,
              index: index + event.index,
              sourceIndex,
            }));
          const leading = text.trimStart();
          const defaults = serializedInventoryPrivilegeRoles
            .parseDefaultFunctionPrivileges(text, targetSchema)
            .map((event) => ({
              ...event,
              index: index + event.index,
              sourceIndex,
            }));
          const roleChange =
            serializedInventoryPrivilegeRoles.parseRoleChange(text);
          const roleEvents = roleChange
            ? [
                {
                  ...roleChange,
                  index: index + roleChange.index,
                  sourceIndex,
                },
              ]
            : [];
          if (!/^(?:GRANT|REVOKE)\b/i.test(leading))
            return [...lifecycle, ...defaults, ...roleEvents];
          const membership =
            serializedInventoryPrivilegeRoles.parseRoleMembership(text);
          const targetPattern = new RegExp(
            `^${privilegeTargetPattern(signature)}$`,
            'i'
          );
          const parsedPrivilege = parseFunctionPrivilege(text);
          const privileges =
            parsedPrivilege &&
            splitFunctionPrivilegeTargets(parsedPrivilege.functionList).some(
              (target) => targetPattern.test(target)
            )
              ? [
                  {
                    index: index + parsedPrivilege.index,
                    kind: 'privilege',
                    match: [parsedPrivilege.operation],
                    grantees: parsedPrivilege.grantees,
                    sourceIndex,
                  },
                ]
              : [];
          const schemaPrivileges = serializedInventoryPrivilegeRoles
            .parseSchemaFunctionPrivileges(text, targetSchema)
            .map((event) => ({
              ...event,
              index: index + event.index,
              sourceIndex,
            }));
          return [
            ...lifecycle,
            ...defaults,
            ...roleEvents,
            ...privileges,
            ...schemaPrivileges,
            ...(membership
              ? [
                  {
                    ...membership,
                    index: index + membership.index,
                    kind: 'membership',
                    sourceIndex,
                  },
                ]
              : []),
          ];
        })
    )
    .sort(
      (left, right) =>
        left.sourceIndex - right.sourceIndex || left.index - right.index
    );
  for (const event of events) {
    if (event.kind === 'role') {
      state.currentRole = event.role;
      if (event.sessionAuthorization) state.sessionUser = event.role;
    } else if (event.kind === 'reset-role') {
      if (event.sessionAuthorization) {
        state.currentRole = 'postgres';
        state.sessionUser = 'postgres';
      } else {
        state.currentRole = state.sessionUser;
      }
    } else if (event.kind === 'drop' || event.kind === 'invalidate') {
      state.exists = false;
      state.grants.clear();
      state.owner = undefined;
    } else if (event.kind === 'create') {
      if (!event.replace || !state.exists) {
        state.grants.clear();
        state.grants.set('public', true);
        state.owner ??= state.currentRole;
        const ownerDefaults = state.defaultGrants.get(state.owner);
        if (ownerDefaults) {
          const defaultedRoles = new Set([
            ...ownerDefaults.global.keys(),
            ...ownerDefaults.schema.keys(),
          ]);
          for (const role of defaultedRoles) {
            state.grants.set(
              role,
              ownerDefaults.global.get(role) === true ||
                ownerDefaults.schema.get(role) === true
            );
          }
        }
      }
      state.exists = true;
    } else if (event.kind === 'owner') {
      state.owner = serializedInventoryPrivilegeRoles.resolveSpecialRole(
        event.owner,
        state.currentRole,
        state.sessionUser
      );
    } else if (event.kind === 'move') {
      state.exists = true;
      state.owner = 'authenticated';
    } else if (event.kind === 'reassign') {
      const references = event.from.map((reference) =>
        serializedInventoryPrivilegeRoles.resolveSpecialRole(
          reference,
          state.currentRole,
          state.sessionUser
        )
      );
      if (state.owner !== undefined && references.includes(state.owner)) {
        state.owner = event.owner;
      }
    } else if (event.kind === 'default') {
      const grant = event.operation === 'GRANT';
      const owner = event.owner ?? state.currentRole;
      const ownerDefaults = state.defaultGrants.get(owner) ?? {
        global: new Map(),
        schema: new Map(),
      };
      const scope =
        event.scope === 'schema' ? ownerDefaults.schema : ownerDefaults.global;
      for (const grantee of splitFunctionPrivilegeTargets(event.grantees)) {
        scope.set(
          serializedInventoryPrivilegeRoles.normalizeRoleName(grantee),
          grant
        );
      }
      state.defaultGrants.set(owner, ownerDefaults);
    } else if (event.kind === 'membership') {
      const usable = event.inheritable !== false || event.settable !== false;
      for (const member of event.members) {
        const resolvedMember =
          serializedInventoryPrivilegeRoles.resolveSpecialRole(
            member,
            state.currentRole,
            state.sessionUser
          );
        const roles = state.memberships.get(resolvedMember) ?? [];
        for (const role of event.roles) {
          const resolvedRole =
            serializedInventoryPrivilegeRoles.resolveSpecialRole(
              role,
              state.currentRole,
              state.sessionUser
            );
          const roleIndex = roles.indexOf(resolvedRole);
          if (event.operation === 'GRANT' && usable && roleIndex === -1)
            roles.push(resolvedRole);
          if (
            (event.operation === 'REVOKE' ||
              (event.operation === 'GRANT' && !usable)) &&
            roleIndex !== -1
          )
            roles.splice(roleIndex, 1);
        }
        if (roles.length > 0) state.memberships.set(resolvedMember, roles);
        else state.memberships.delete(resolvedMember);
      }
    } else {
      const grant = /^GRANT/i.test(event.match[0]);
      const grantees = event.grantees ?? event.match[1];
      for (const grantee of splitFunctionPrivilegeTargets(grantees)) {
        state.grants.set(
          serializedInventoryPrivilegeRoles.resolveSpecialRole(
            serializedInventoryPrivilegeRoles.normalizeRoleName(grantee),
            state.currentRole,
            state.sessionUser
          ),
          grant
        );
      }
    }
  }
  return (
    state.exists &&
    (serializedInventoryPrivilegeRoles.canExecuteAs(
      'authenticated',
      state.grants,
      state.memberships
    ) ||
      (state.owner !== undefined &&
        serializedInventoryPrivilegeRoles.canExecuteAs(
          'authenticated',
          new Map([[state.owner, true]]),
          state.memberships
        )))
  );
}

export const serializedInventoryPrivilegeExecution = {
  authenticatedCanExecute,
};

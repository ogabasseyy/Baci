import { serializedInventoryDynamicDdl } from './serialized_variant_inventory_concurrency_contract_dynamic_ddl.mjs';
import { serializedInventoryPrivilegeLifecycle } from './serialized_variant_inventory_concurrency_contract_privilege_lifecycle.mjs';
import { serializedInventoryPrivilegeRoles } from './serialized_variant_inventory_concurrency_contract_privilege_roles.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function signaturePattern(signature) {
  return escapeRegex(signature)
    .replaceAll('\\.', '\\s*\\.\\s*')
    .replaceAll(',', '\\s*,\\s*')
    .replaceAll(' ', '\\s+');
}

function identifierPattern(identifier) {
  return identifier
    .split('.')
    .map((part) => {
      const unquoted = part.replace(/^"|"$/g, '');
      return `(?:${escapeRegex(unquoted)}|"${escapeRegex(unquoted)}")`;
    })
    .join('\\s*\\.\\s*');
}

function schemaNameFromSignature(signature) {
  const match = /^(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s*\./i.exec(signature);
  return (match?.[1] ?? match?.[2] ?? '').toLowerCase();
}

const maskedSourceCache = new Map();

function maskSqlStringLiterals(source) {
  const cached = maskedSourceCache.get(source);
  if (cached !== undefined) return cached;
  const commentFree = serializedInventorySqlParser.stripSqlComments(source);
  const masked = commentFree.replace(/'(?:''|\\[\s\S]|[^'])*'/g, (literal) =>
    literal.replace(/[^\r\n]/g, ' ')
  );
  maskedSourceCache.set(source, masked);
  return masked;
}

function privilegeTargetPattern(signature) {
  const parsed = /^(.*)\(([^()]*)\)$/.exec(signature);
  if (!parsed) return signaturePattern(signature);
  return `${identifierPattern(parsed[1].trim())}\\s*\\(\\s*${signaturePattern(parsed[2].trim())}\\s*\\)`;
}

function splitFunctionPrivilegeTargets(source) {
  const targets = [];
  let start = 0;
  let depth = 0;
  let quote;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index + 1] === quote) index += 1;
      else if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      targets.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  targets.push(source.slice(start).trim());
  return targets;
}

function parseFunctionPrivilege(text) {
  const leading = text.trimStart();
  const prefix =
    /^(?:GRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)|REVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE))\s+ON\s+(?:FUNCTION|ROUTINE)\s+/i.exec(
      leading
    );
  if (!prefix) return null;
  let depth = 0;
  let quote;
  for (let index = prefix[0].length; index < leading.length; index += 1) {
    const char = leading[index];
    if (quote) {
      if (char === quote && leading[index + 1] === quote) index += 1;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const keyword = /^\s+(?:TO|FROM)\s+/i.exec(leading.slice(index));
      if (keyword) {
        return {
          functionList: leading.slice(prefix[0].length, index).trim(),
          grantees: leading
            .slice(index + keyword[0].length)
            .replace(/;\s*$/, '')
            .replace(/\s+WITH\s+GRANT\s+OPTION\s*$/i, '')
            .trim(),
          index: text.length - leading.length,
          operation: /^GRANT/i.test(prefix[0]) ? 'GRANT' : 'REVOKE',
        };
      }
    }
  }
  return null;
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
          if (!/^(?:GRANT|REVOKE)\b/i.test(leading))
            return [...lifecycle, ...defaults];
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
    if (event.kind === 'drop' || event.kind === 'invalidate') {
      state.exists = false;
      state.grants.clear();
      state.owner = undefined;
    } else if (event.kind === 'create') {
      if (!event.replace || !state.exists) {
        state.grants.clear();
        state.grants.set('public', true);
        for (const [role, grant] of state.defaultGrants) {
          state.grants.set(role, grant);
        }
      }
      state.exists = true;
    } else if (event.kind === 'owner') {
      state.owner = event.owner;
    } else if (event.kind === 'default') {
      const grant = event.operation === 'GRANT';
      for (const grantee of splitFunctionPrivilegeTargets(event.grantees)) {
        state.defaultGrants.set(
          serializedInventoryPrivilegeRoles.normalizeRoleName(grantee),
          grant
        );
      }
    } else if (event.kind === 'membership') {
      for (const member of event.members) {
        const roles = state.memberships.get(member) ?? [];
        for (const role of event.roles) {
          const roleIndex = roles.indexOf(role);
          if (event.operation === 'GRANT' && roleIndex === -1) roles.push(role);
          if (event.operation === 'REVOKE' && roleIndex !== -1)
            roles.splice(roleIndex, 1);
        }
        if (roles.length > 0) state.memberships.set(member, roles);
        else state.memberships.delete(member);
      }
    } else {
      const grant = /^GRANT/i.test(event.match[0]);
      const grantees = event.grantees ?? event.match[1];
      for (const grantee of splitFunctionPrivilegeTargets(grantees)) {
        state.grants.set(
          serializedInventoryPrivilegeRoles.normalizeRoleName(grantee),
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

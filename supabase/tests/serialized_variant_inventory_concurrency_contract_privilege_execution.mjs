import { serializedInventoryDynamicDdl } from './serialized_variant_inventory_concurrency_contract_dynamic_ddl.mjs';
import { serializedInventoryPrivilegeLifecycle } from './serialized_variant_inventory_concurrency_contract_privilege_lifecycle.mjs';
import { serializedInventoryPrivilegeParser } from './serialized_variant_inventory_concurrency_contract_privilege_parser.mjs';
import { serializedInventoryPrivilegeRoles } from './serialized_variant_inventory_concurrency_contract_privilege_roles.mjs';
import { serializedInventoryPrivilegeTransitions } from './serialized_variant_inventory_concurrency_contract_privilege_transitions.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { parseFunctionPrivilege, privilegeTargetPattern } =
  serializedInventoryPrivilegeParser;
const { splitTopLevelList } = serializedInventorySqlParser;
const { applyPrivilegeEvent, createPrivilegeState } =
  serializedInventoryPrivilegeTransitions;

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
  const state = createPrivilegeState();
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
                    grantor: parsedPrivilege.grantor,
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
  for (const event of events) applyPrivilegeEvent(state, event);
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

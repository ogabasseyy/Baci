import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const roleIdentifier = '(?:"[^"]+"|[a-z_][a-z0-9_]*)';
const grantorIdentifier = `(?:${roleIdentifier}|CURRENT_ROLE|CURRENT_USER|SESSION_USER)`;
const roleMembershipPattern = new RegExp(
  `^(GRANT|REVOKE)\\s+(${roleIdentifier}(?:\\s*,\\s*${roleIdentifier})*)\\s+(?:TO|FROM)\\s+(${roleIdentifier}(?:\\s*,\\s*${roleIdentifier})*)(?:\\s+WITH\\s+(?:ADMIN|INHERIT|SET)\\s+(?:OPTION|TRUE|FALSE)(?:\\s*,\\s*(?:ADMIN|INHERIT|SET)\\s+(?:OPTION|TRUE|FALSE))*)?(?:\\s+GRANTED\\s+BY\\s+${grantorIdentifier}(?:\\s*,\\s*${grantorIdentifier})*)?\\s*;?$`,
  'i'
);
const defaultFunctionPrivilegePattern =
  /ALTER\s+DEFAULT\s+PRIVILEGES(?:\s+FOR\s+(?:ROLE|USER)\s+((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\s*,\s*(?:"[^"]+"|[a-z_][a-z0-9_]*))*))?(?:\s+IN\s+SCHEMA\s+((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\s*,\s*(?:"[^"]+"|[a-z_][a-z0-9_]*))*))?\s+(GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+(?:ALL\s+)?(?:FUNCTIONS|ROUTINES)\s+(?:TO|FROM)\s+([^;]+);/gi;
const schemaFunctionPrivilegePattern =
  /(?:GRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)|REVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE))\s+ON\s+ALL\s+(?:FUNCTIONS|ROUTINES)\s+IN\s+SCHEMA\s+([^;]+?)\s+(TO|FROM)\s+([^;]+?)(?:\s+GRANTED\s+BY\s+[^;]+)?\s*;/gi;

function normalizeRoleName(role) {
  return role
    .trim()
    .replace(/^GROUP\s+/i, '')
    .replace(
      /\s+WITH\s+(?:ADMIN|INHERIT|SET)\s+(?:OPTION|TRUE|FALSE)(?:\s*,\s*(?:ADMIN|INHERIT|SET)\s+(?:OPTION|TRUE|FALSE))*$/i,
      ''
    )
    .replace(/\s+WITH\s+GRANT\s+OPTION$/i, '')
    .replace(/^"|"$/g, '')
    .toLowerCase();
}

function parseRoleMembership(text) {
  const leading = text.trim();
  const match = roleMembershipPattern.exec(leading);
  if (!match) return null;
  return {
    index: text.indexOf(leading),
    inheritable: !/\bINHERIT\s+FALSE\b/i.test(leading),
    members: serializedInventorySqlParser
      .splitTopLevelList(match[3])
      .map(normalizeRoleName),
    operation: match[1].toUpperCase(),
    roles: serializedInventorySqlParser
      .splitTopLevelList(match[2])
      .map(normalizeRoleName),
  };
}

function parseRoleChange(text) {
  const leading = text.trim();
  const setRole =
    /^SET\s+(?:LOCAL\s+|SESSION\s+)?ROLE\s+("[^"]+"|[a-z_][a-z0-9_]*)\s*;?$/i.exec(
      leading
    );
  if (setRole) {
    return {
      index: text.indexOf(leading),
      kind: 'role',
      role: normalizeRoleName(setRole[1]),
    };
  }
  const setSessionAuthorization =
    /^SET\s+SESSION\s+AUTHORIZATION\s+("[^"]+"|[a-z_][a-z0-9_]*)\s*;?$/i.exec(
      leading
    );
  if (setSessionAuthorization) {
    if (/^default$/i.test(setSessionAuthorization[1])) {
      return {
        index: text.indexOf(leading),
        kind: 'reset-role',
      };
    }
    return {
      index: text.indexOf(leading),
      kind: 'role',
      role: normalizeRoleName(setSessionAuthorization[1]),
    };
  }
  if (
    /^RESET\s+ROLE\s*;?$/i.test(leading) ||
    /^RESET\s+SESSION\s+AUTHORIZATION\s*;?$/i.test(leading)
  ) {
    return {
      index: text.indexOf(leading),
      kind: 'reset-role',
    };
  }
  return null;
}

function parseDefaultFunctionPrivileges(text, targetSchema) {
  defaultFunctionPrivilegePattern.lastIndex = 0;
  return [...text.matchAll(defaultFunctionPrivilegePattern)]
    .filter(
      (match) =>
        match[2] === undefined ||
        match[2]
          .split(',')
          .map((schema) => schema.trim().replace(/^"|"$/g, '').toLowerCase())
          .includes(targetSchema.toLowerCase())
    )
    .flatMap((match) =>
      (match[1] === undefined
        ? [null]
        : serializedInventorySqlParser.splitTopLevelList(match[1])
      ).map((owner) => ({
        index: match.index,
        kind: 'default',
        owner: owner === null ? null : normalizeRoleName(owner),
        operation: match[3],
        grantees: match[4],
        scope: match[2] === undefined ? 'global' : 'schema',
      }))
    );
}

function parseSchemaFunctionPrivileges(text, targetSchema) {
  schemaFunctionPrivilegePattern.lastIndex = 0;
  return [...text.matchAll(schemaFunctionPrivilegePattern)]
    .filter((match) =>
      match[1]
        .split(',')
        .map((schema) => schema.trim().replace(/^"|"$/g, '').toLowerCase())
        .includes(targetSchema)
    )
    .map((match) => ({
      index: match.index,
      kind: 'privilege',
      match,
      grantees: match[3],
    }));
}

function canExecuteAs(role, grants, memberships, visited = new Set()) {
  const normalizedRole = normalizeRoleName(role);
  if (grants.get('public') === true || grants.get(normalizedRole) === true) {
    return true;
  }
  if (visited.has(normalizedRole)) return false;
  visited.add(normalizedRole);
  return (memberships.get(normalizedRole) ?? []).some((parent) =>
    canExecuteAs(parent, grants, memberships, visited)
  );
}

export const serializedInventoryPrivilegeRoles = {
  canExecuteAs,
  normalizeRoleName,
  parseDefaultFunctionPrivileges,
  parseRoleChange,
  parseSchemaFunctionPrivileges,
  parseRoleMembership,
};

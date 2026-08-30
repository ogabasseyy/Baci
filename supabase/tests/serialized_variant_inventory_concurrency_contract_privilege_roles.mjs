const roleIdentifier = '(?:"[^"]+"|[a-z_][a-z0-9_]*)';
const roleMembershipPattern = new RegExp(
  `^(GRANT|REVOKE)\\s+(${roleIdentifier}(?:\\s*,\\s*${roleIdentifier})*)\\s+(?:TO|FROM)\\s+(${roleIdentifier}(?:\\s*,\\s*${roleIdentifier})*)(?:\\s+WITH\\s+(?:ADMIN|INHERIT|SET)\\s+(?:OPTION|TRUE|FALSE)(?:\\s*,\\s*(?:ADMIN|INHERIT|SET)\\s+(?:OPTION|TRUE|FALSE))*)?\\s*;?$`,
  'i'
);
const defaultFunctionPrivilegePattern =
  /ALTER\s+DEFAULT\s+PRIVILEGES(?:\s+FOR\s+(?:ROLE|USER)\s+((?:"[^"]+"|[a-z_][a-z0-9_]*)))?(?:\s+IN\s+SCHEMA\s+((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\s*,\s*(?:"[^"]+"|[a-z_][a-z0-9_]*))*))?\s+(GRANT|REVOKE)\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)\s+ON\s+(?:ALL\s+)?(?:FUNCTIONS|ROUTINES)\s+(?:TO|FROM)\s+([^;]+);/gi;
const schemaFunctionPrivilegePattern =
  /(?:GRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)|REVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE))\s+ON\s+ALL\s+(?:FUNCTIONS|ROUTINES)\s+IN\s+SCHEMA\s+([^;]+?)\s+(TO|FROM)\s+([^;]+);/gi;

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
    members: match[3].split(',').map(normalizeRoleName),
    operation: match[1].toUpperCase(),
    roles: match[2].split(',').map(normalizeRoleName),
  };
}

function parseRoleChange(text) {
  const leading = text.trim();
  const setRole = /^SET\s+ROLE\s+("[^"]+"|[a-z_][a-z0-9_]*)\s*;?$/i.exec(
    leading
  );
  if (setRole) {
    return {
      index: text.indexOf(leading),
      kind: 'role',
      role: normalizeRoleName(setRole[1]),
    };
  }
  if (/^RESET\s+ROLE\s*;?$/i.test(leading)) {
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
        (match[2] ?? targetSchema)
          .split(',')
          .map((schema) => schema.trim().replace(/^"|"$/g, '').toLowerCase())
          .includes(targetSchema.toLowerCase())
    )
    .map((match) => ({
      index: match.index,
      kind: 'default',
      owner: normalizeRoleName(match[1] ?? 'postgres'),
      operation: match[3],
      grantees: match[4],
    }));
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

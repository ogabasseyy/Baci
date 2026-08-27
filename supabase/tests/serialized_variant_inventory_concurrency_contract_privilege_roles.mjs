const roleIdentifier = '(?:"[^"]+"|[a-z_][a-z0-9_]*)';
const roleMembershipPattern = new RegExp(
  `^(GRANT|REVOKE)\\s+(${roleIdentifier}(?:\\s*,\\s*${roleIdentifier})*)\\s+(?:TO|FROM)\\s+(${roleIdentifier}(?:\\s*,\\s*${roleIdentifier})*)\\s*;?$`,
  'i'
);

function normalizeRoleName(role) {
  return role.trim().replace(/^"|"$/g, '').toLowerCase();
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
  parseRoleMembership,
};

import { serializedInventoryPrivilegeRoles } from './serialized_variant_inventory_concurrency_contract_privilege_roles.mjs';

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

function functionLifecycleEvents(source, signature) {
  const parsed = /^(.*)\(([^()]*)\)$/.exec(signature);
  if (!parsed) return [];
  const parameters = parsed[2]
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean)
    .map(
      (type) =>
        `\\s*(?:(?:INOUT|IN|VARIADIC)\\s+)?(?:(?:"[^"]+"|[a-z_][a-z0-9_]*)\\s+)?${signaturePattern(type)}(?:\\s+(?:DEFAULT\\b|=)[^,)]*)?\\s*`
    )
    .join('\\s*,\\s*');
  const name = identifierPattern(parsed[1].trim());
  const functionReference = `${name}\\s*\\(${parameters}\\)`;
  const creates = [
    ...source.matchAll(
      new RegExp(
        `CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+${functionReference}`,
        'gi'
      )
    ),
  ].map((match) => ({
    index: match.index,
    kind: 'create',
    replace: match[1] !== undefined,
  }));
  const drops = [
    ...source.matchAll(
      new RegExp(
        `(?:DROP\\s+(?:FUNCTION|ROUTINE)(?:\\s+IF\\s+EXISTS)?\\s+(?:(?!;)[\\s\\S])*?${functionReference}(?=\\s*(?:,|(?:CASCADE|RESTRICT)?;))[^;]*;|ALTER\\s+(?:FUNCTION|ROUTINE)\\s+${functionReference}\\s+OWNER\\s+TO\\s+("[^"]+"|[a-z_][a-z0-9_]*)\\s*;|ALTER\\s+(?:FUNCTION|ROUTINE)\\s+${functionReference}\\s+(?:RENAME\\s+TO|SET\\s+SCHEMA)\\s+(?:"[^"]+"|[a-z_][a-z0-9_]*)\\s*;)`,
        'gi'
      )
    ),
  ].map((match) => {
    if (!/^ALTER/i.test(match[0])) return { index: match.index, kind: 'drop' };
    if (/OWNER\s+TO/i.test(match[0])) {
      return {
        index: match.index,
        kind: 'owner',
        owner: serializedInventoryPrivilegeRoles.normalizeRoleName(match[1]),
      };
    }
    return { index: match.index, kind: 'invalidate' };
  });
  return [...creates, ...drops].sort((left, right) => left.index - right.index);
}

export const serializedInventoryPrivilegeLifecycle = {
  functionLifecycleEvents,
};

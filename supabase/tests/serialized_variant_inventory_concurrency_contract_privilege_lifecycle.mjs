import { serializedInventoryPrivilegeRoles } from './serialized_variant_inventory_concurrency_contract_privilege_roles.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { escapeRegex } = serializedInventorySqlParser;

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
  const outParameter = `OUT\\s+(?:(?:"[^"]+"|[a-z_][a-z0-9_]*)\\s+)?[a-z_][a-z0-9_.%]+(?:\\s+[a-z_][a-z0-9_.%]+)*(?:\\s*\\([^()]*\\))?`;
  const allParameters = parameters
    ? `${parameters}(?:\\s*,\\s*${outParameter})*`
    : `(?:\\s*${outParameter}(?:\\s*,\\s*${outParameter})*)?`;
  const name = identifierPattern(parsed[1].trim());
  const functionReference = `${name}\\s*\\(${allParameters}\\)`;
  const identityParts = [
    ...parsed[1].trim().matchAll(/"[^"]+"|[a-z_][a-z0-9_]*/gi),
  ].map((part) => part[0].replace(/^"|"$/g, '').toLowerCase());
  const identitySchema = identityParts.at(-2);
  const identityName = identityParts.at(-1);
  const argumentListPattern = new RegExp(`^(?:${allParameters})$`, 'i');
  const inboundMoves = [
    ...source.matchAll(
      /ALTER\s+(?:FUNCTION|ROUTINE)\s+((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\s*\.\s*(?:"[^"]+"|[a-z_][a-z0-9_]*))?)\s*\(([^()]*)\)\s+(RENAME\s+TO\s+(?:"[^"]+"|[a-z_][a-z0-9_]*)|SET\s+SCHEMA\s+(?:"[^"]+"|[a-z_][a-z0-9_]*))\s*;/gi
    ),
  ]
    .filter((match) => {
      const sourceParts = [
        ...match[1].matchAll(/"[^"]+"|[a-z_][a-z0-9_]*/gi),
      ].map((part) => part[0].replace(/^"|"$/g, '').toLowerCase());
      if (!argumentListPattern.test(match[2])) return false;
      if (/^RENAME/i.test(match[3])) {
        const targetName = /RENAME\s+TO\s+(?:"[^"]+"|[a-z_][a-z0-9_]*)/i
          .exec(match[3])[0]
          .replace(/^RENAME\s+TO\s+/i, '')
          .replace(/^"|"$/g, '')
          .toLowerCase();
        return (
          sourceParts.at(-2) === identitySchema &&
          targetName === identityName &&
          sourceParts.at(-1) !== identityName
        );
      }
      const targetSchema = /SET\s+SCHEMA\s+(?:"[^"]+"|[a-z_][a-z0-9_]*)/i
        .exec(match[3])[0]
        .replace(/^SET\s+SCHEMA\s+/i, '')
        .replace(/^"|"$/g, '')
        .toLowerCase();
      return (
        sourceParts.at(-1) === identityName &&
        targetSchema === identitySchema &&
        sourceParts.at(-2) !== identitySchema
      );
    })
    .map((match) => ({ index: match.index, kind: 'create', replace: false }));
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
  const reassigns = [
    ...source.matchAll(
      /REASSIGN\s+OWNED\s+BY\s+((?:"[^"]+"|[a-z_][a-z0-9_]*)(?:\s*,\s*(?:"[^"]+"|[a-z_][a-z0-9_]*))*)\s+TO\s+("[^"]+"|[a-z_][a-z0-9_]*)\s*;/gi
    ),
  ].map((match) => ({
    index: match.index,
    kind: 'reassign',
    from: match[1]
      .split(',')
      .map((role) => serializedInventoryPrivilegeRoles.normalizeRoleName(role)),
    owner: serializedInventoryPrivilegeRoles.normalizeRoleName(match[2]),
  }));
  return [...creates, ...inboundMoves, ...drops, ...reassigns].sort(
    (left, right) => left.index - right.index
  );
}

export const serializedInventoryPrivilegeLifecycle = {
  functionLifecycleEvents,
};

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

function privilegeTargetPattern(signature) {
  const parsed = /^(.*)\(([^()]*)\)$/.exec(signature);
  if (!parsed) return signaturePattern(signature);
  const argumentTypes = parsed[2]
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean)
    .map((type) => {
      const unqualified = type.replace(/^pg_catalog\s*\.\s*/i, '');
      return `(?:(?:pg_catalog\\s*\\.\\s*)?${signaturePattern(unqualified)})`;
    })
    .join('\\s*,\\s*');
  const fullName = identifierPattern(parsed[1].trim());
  const bareName = identifierPattern(parsed[1].trim().split('.').pop());
  return (
    `(?:${fullName}|${bareName})` +
    '(?:\\s*\\(\\s*' +
    argumentTypes +
    '\\s*\\))?'
  );
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
        const operation = /^GRANT/i.test(prefix[0]) ? 'GRANT' : 'REVOKE';
        const granteeClause = leading
          .slice(index + keyword[0].length)
          .replace(/;\s*$/, '');
        const grantor =
          /\bGRANTED\s+BY\s+("[^"]+"|[a-z_][a-z0-9_]*)/i.exec(
            granteeClause
          )?.[1] ?? null;
        return {
          functionList: leading.slice(prefix[0].length, index).trim(),
          grantees: granteeClause
            .replace(
              /\s+(?:WITH\s+GRANT\s+OPTION|GRANTED\s+BY\s+(?:"[^"]+"|[a-z_][a-z0-9_]*))(?:\s+(?:WITH\s+GRANT\s+OPTION|GRANTED\s+BY\s+(?:"[^"]+"|[a-z_][a-z0-9_]*)))*\s*$/i,
              ''
            )
            .trim(),
          grantor,
          index: text.length - leading.length,
          operation,
        };
      }
    }
  }
  return null;
}

export const serializedInventoryPrivilegeParser = {
  parseFunctionPrivilege,
  privilegeTargetPattern,
};

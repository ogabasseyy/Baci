import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
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
  const name = signaturePattern(parsed[1]);
  const creates = [
    ...source.matchAll(
      new RegExp(
        `CREATE\\s+(OR\\s+REPLACE\\s+)?FUNCTION\\s+${name}\\s*\\(${parameters}\\)`,
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
        `DROP\\s+FUNCTION(?:\\s+IF\\s+EXISTS)?\\s+${signaturePattern(signature)}[^;]*;`,
        'gi'
      )
    ),
  ].map((match) => ({ index: match.index, kind: 'drop' }));
  return [...creates, ...drops];
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
            .trim(),
          index: text.length - leading.length,
          operation: /^GRANT/i.test(prefix[0]) ? 'GRANT' : 'REVOKE',
        };
      }
    }
  }
  return null;
}

function authenticatedCanExecute(source, signature) {
  const state = { authenticated: false, exists: false, public: false };
  const executable = maskSqlStringLiterals(source);
  const schemaPattern =
    /(?:GRANT\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE)|REVOKE\s+(?:ALL(?:\s+PRIVILEGES)?|EXECUTE))\s+ON\s+ALL\s+(?:FUNCTIONS|ROUTINES)\s+IN\s+SCHEMA\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+(?:TO|FROM)\s+([^;]+);/gi;
  const targetSchema = schemaNameFromSignature(signature);
  const events = serializedInventorySqlParser
    .splitSqlStatements(executable)
    .flatMap(({ index, text }) => {
      const lifecycle = functionLifecycleEvents(text, signature).map(
        (event) => ({ ...event, index: index + event.index })
      );
      const leading = text.trimStart();
      if (!/^(?:GRANT|REVOKE)\b/i.test(leading)) return lifecycle;
      const targetPattern = new RegExp(`^${signaturePattern(signature)}$`, 'i');
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
              },
            ]
          : [];
      schemaPattern.lastIndex = 0;
      const schemaPrivileges = [...text.matchAll(schemaPattern)]
        .filter(
          (match) => (match[1] ?? match[2]).toLowerCase() === targetSchema
        )
        .map((match) => ({
          index: index + match.index,
          kind: 'privilege',
          match,
          grantees: match[3],
        }));
      return [...lifecycle, ...privileges, ...schemaPrivileges];
    })
    .sort((left, right) => left.index - right.index);
  for (const event of events) {
    if (event.kind === 'drop') {
      state.exists = false;
      state.public = false;
      state.authenticated = false;
    } else if (event.kind === 'create') {
      if (!event.replace || !state.exists) {
        state.public = true;
        state.authenticated = false;
      }
      state.exists = true;
    } else {
      const grant = /^GRANT/i.test(event.match[0]);
      const grantees = event.grantees ?? event.match[1];
      if (/\bPUBLIC\b/i.test(grantees)) state.public = grant;
      if (/\bauthenticated\b/i.test(grantees)) state.authenticated = grant;
    }
  }
  return state.exists && (state.public || state.authenticated);
}

function directPrivateDelegation(body) {
  const opening = /\bAS\s+(\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$)/i.exec(body);
  const functionSource = opening
    ? body.slice(opening.index + opening[0].length)
    : body;
  const executable = serializedInventorySqlParser
    .maskSqlLiterals(functionSource)
    .replace(/\s+/g, ' ')
    .trim();
  return (
    /^(?:BEGIN\s+)?RETURN(?:\s+QUERY)?\s+(?:SELECT\s+.+\s+FROM\s+)?private\.[a-z_][a-z0-9_]*\s*\([^;]*\)\s*;\s*(?:END;?)?$/i.test(
      executable
    ) ||
    /^SELECT\s+(?:private\.[a-z_][a-z0-9_]*|.+\s+FROM\s+private\.[a-z_][a-z0-9_]*)[^;]*;$/i.test(
      executable
    )
  );
}

function dynamicDefinerPromotionSource(source) {
  if (
    !/function_definition\.prosecdef\s+IS\s+FALSE/i.test(source) ||
    !/function_definition\.prosrc\s+LIKE\s+'%private\.%'/i.test(source)
  ) {
    return -1;
  }
  return (
    /ALTER\s+FUNCTION\s+%s\s+SECURITY\s+DEFINER/i.exec(source)?.index ?? -1
  );
}

function effectiveSecurityMode(sourceOrSources, signature) {
  const sources = Array.isArray(sourceOrSources)
    ? sourceOrSources
    : [sourceOrSources];
  const normalizedSources = sources.map((source) =>
    serializedInventorySqlParser.stripSqlComments(source)
  );
  const body = serializedInventoryContract.latestFunctionBody(
    signature,
    normalizedSources
  );
  const createMode = /\bSECURITY\s+(DEFINER|INVOKER)\b/i.exec(body);
  const definitionSourceIndex = normalizedSources.findLastIndex((source) =>
    source.includes(body)
  );
  const definitionIndex =
    normalizedSources[definitionSourceIndex].lastIndexOf(body);
  const alterationPattern = new RegExp(
    `ALTER\\s+(?:FUNCTION|ROUTINE)\\s+${signaturePattern(signature)}\\s+SECURITY\\s+(DEFINER|INVOKER)\\s*;`,
    'gi'
  );
  const alterations = normalizedSources.flatMap((source, sourceIndex) =>
    [
      ...serializedInventorySqlParser
        .maskSqlLiterals(source)
        .matchAll(alterationPattern),
    ]
      .filter(
        (match) =>
          sourceIndex > definitionSourceIndex ||
          (sourceIndex === definitionSourceIndex &&
            match.index > definitionIndex)
      )
      .map((match) => ({
        index: match.index,
        mode: match[1],
        sourceIndex,
      }))
  );
  const latestAlter = alterations.at(-1);
  const dynamicSourceIndex = normalizedSources.findIndex(
    (source) => dynamicDefinerPromotionSource(source) >= 0
  );
  const dynamicPromotionIndex =
    dynamicSourceIndex >= 0
      ? dynamicDefinerPromotionSource(normalizedSources[dynamicSourceIndex])
      : -1;
  const dynamicPromotion =
    schemaNameFromSignature(signature) === 'public' &&
    directPrivateDelegation(body) &&
    dynamicSourceIndex > definitionSourceIndex &&
    (latestAlter === undefined ||
      dynamicSourceIndex > latestAlter.sourceIndex ||
      (dynamicSourceIndex === latestAlter.sourceIndex &&
        dynamicPromotionIndex > latestAlter.index));
  if (dynamicPromotion) return 'definer';
  return latestAlter?.mode.toLowerCase() ?? createMode?.[1].toLowerCase();
}

export const serializedInventoryPrivileges = {
  authenticatedCanExecute,
  effectiveSecurityMode,
};

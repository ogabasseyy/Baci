import { serializedInventoryContract } from './serialized_variant_inventory_concurrency_contract.mjs';
import { serializedInventoryPrivilegeExecution } from './serialized_variant_inventory_concurrency_contract_privilege_execution.mjs';
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

function authenticatedCanExecute(source, signature) {
  return serializedInventoryPrivilegeExecution.authenticatedCanExecute(
    source,
    signature
  );
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

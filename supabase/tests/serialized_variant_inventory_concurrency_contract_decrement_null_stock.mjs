import { serializedInventoryBranches } from './serialized_variant_inventory_concurrency_contract_branches.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { maskSqlLiterals } = serializedInventorySqlParser;
const nullStockHandlerPattern =
  /^\s*IF\s+current_stock\s+IS\s+NULL\s+THEN(?:(?!\bEND\s+IF\b)[\s\S])*?END\s+IF\s*;/i;

function tryExtractIfArms(source, openingPattern) {
  try {
    return serializedInventoryBranches.extractIfArms(source, openingPattern);
  } catch {
    return undefined;
  }
}

function hasTopLevelExit(source) {
  const masked = maskSqlLiterals(source);
  let depth = 0;
  let caseDepth = 0;
  for (const token of masked.matchAll(
    /\bEND\s+IF\b|\bEND\s+CASE\b|\bIF\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b|\bCASE\b|\bRAISE\s+EXCEPTION\b|\bRETURN\s*;/gi
  )) {
    if (/^END\s+IF/i.test(token[0])) depth = Math.max(0, depth - 1);
    else if (/^END\s+CASE/i.test(token[0]))
      caseDepth = Math.max(0, caseDepth - 1);
    else if (/^IF\b/i.test(token[0])) depth += 1;
    else if (/^CASE$/i.test(token[0])) caseDepth += 1;
    else if (depth === 0 && caseDepth === 0) return true;
  }
  return false;
}

function inspectNullStockHandler(source, offset) {
  const handler = nullStockHandlerPattern.exec(source.slice(offset));
  if (!handler) return null;
  const arms = tryExtractIfArms(
    handler[0],
    /^\s*IF\s+current_stock\s+IS\s+NULL\s+THEN\b/i
  );
  return {
    length: handler[0].length,
    valid: arms !== undefined && hasTopLevelExit(arms.thenBranch),
  };
}

export const serializedInventoryNullStock = {
  hasTopLevelExit,
  inspectNullStockHandler,
  tryExtractIfArms,
};

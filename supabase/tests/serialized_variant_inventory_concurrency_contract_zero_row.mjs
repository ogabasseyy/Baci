import { serializedInventoryBranches } from './serialized_variant_inventory_concurrency_contract_branches.mjs';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

function hasTopLevelException(source) {
  const masked = serializedInventorySqlParser.maskSqlLiterals(source);
  let depth = 0;
  let caseDepth = 0;
  for (const token of masked.matchAll(
    /\bEND\s+IF\b|\bEND\s+CASE\b|\bIF\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b|\bCASE\b|\bRAISE\s+EXCEPTION\b/gi
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

function hasImmediateUnconditionalException(match) {
  if (!match || typeof match.input !== 'string' || match.index === undefined) {
    return false;
  }
  const remainder = match.input.slice(match.index + match[0].length);
  const opening = /^\s*IF\s+NOT\s+FOUND\s+THEN\b/i.exec(remainder);
  if (!opening) return false;
  try {
    const branches = serializedInventoryBranches.extractIfArms(
      remainder,
      /^\s*IF\s+NOT\s+FOUND\s+THEN\b/i
    );
    return hasTopLevelException(branches.thenBranch);
  } catch {
    return false;
  }
}

export { hasImmediateUnconditionalException };

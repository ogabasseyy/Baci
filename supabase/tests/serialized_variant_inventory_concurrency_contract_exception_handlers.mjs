import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

const { maskSqlLiterals } = serializedInventorySqlParser;

const authorizationFailurePattern =
  /\binsufficient_privilege\b|\bSQLSTATE\s+'42501'|\bOTHERS\b/i;
const shortageFailurePattern =
  /\bobject_not_in_prerequisite_state\b|\bSQLSTATE\s+'55000'|\bOTHERS\b/i;

function exceptionRegions(source) {
  const masked = maskSqlLiterals(source);
  const regions = [];
  const stack = [];
  const tokens = masked.matchAll(
    /\bBEGIN\b|(?<!\bRAISE\s+)EXCEPTION\b|\bCASE\b|\bEND\s+CASE\b|\bEND\b(?!\s+(?:IF|LOOP|CASE)\b)/gi
  );
  for (const token of tokens) {
    const keyword = token[0].toUpperCase();
    if (keyword === 'BEGIN' || keyword === 'CASE') {
      stack.push({ beginIndex: token.index, type: keyword.toLowerCase() });
    } else if (keyword === 'EXCEPTION') {
      const block = stack.findLast((entry) => entry.type === 'begin');
      if (block) {
        regions.push({
          beginIndex: block.beginIndex,
          endIndex: -1,
          exceptionIndex: token.index,
        });
      }
    } else if (/^END\s+CASE$/i.test(token[0])) {
      if (stack.at(-1)?.type === 'case') stack.pop();
    } else {
      const entry = stack.pop();
      if (entry?.type === 'begin') {
        for (const region of regions) {
          if (
            region.beginIndex === entry.beginIndex &&
            region.endIndex === -1
          ) {
            region.endIndex = token.index;
          }
        }
      }
    }
  }
  return regions;
}

function enclosingHandlerCatches(source, index, conditionPattern) {
  return exceptionRegions(source).some(
    (region) =>
      region.beginIndex < index &&
      index < region.exceptionIndex &&
      conditionPattern.test(
        source.slice(
          region.exceptionIndex,
          region.endIndex === -1 ? undefined : region.endIndex
        )
      )
  );
}

function indexInExceptionHandler(source, index) {
  return exceptionRegions(source).some(
    (region) =>
      region.exceptionIndex < index &&
      (region.endIndex === -1 || index < region.endIndex)
  );
}

function enclosingAuthorizationHandler(source, index) {
  return enclosingHandlerCatches(source, index, authorizationFailurePattern);
}

function enclosingShortageHandler(source, index) {
  return enclosingHandlerCatches(source, index, shortageFailurePattern);
}

export const serializedInventoryExceptionHandlers = {
  enclosingAuthorizationHandler,
  enclosingHandlerCatches,
  enclosingShortageHandler,
  exceptionRegions,
  indexInExceptionHandler,
};

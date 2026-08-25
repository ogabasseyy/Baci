import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

function pathAt(source, targetIndex) {
  const searchable = serializedInventorySqlParser.maskSqlLiterals(source);
  const stack = [];
  const tokens =
    /\bEND\s+IF\b|\bELSIF\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b|\bELSE\b|\bIF\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b/gi;
  for (const token of searchable.matchAll(tokens)) {
    if (token.index >= targetIndex) break;
    if (/^END\s+IF$/i.test(token[0])) stack.pop();
    else if (/^(?:ELSIF|ELSE)\b/i.test(token[0])) {
      if (stack.length > 0) stack[stack.length - 1] = token.index;
    } else stack.push(token.index);
  }
  return stack;
}

function dominatesControlFlow(source, prerequisiteIndex, targetIndex) {
  const prerequisitePath = pathAt(source, prerequisiteIndex);
  const targetPath = pathAt(source, targetIndex);
  return prerequisitePath.every(
    (branch, index) => targetPath[index] === branch
  );
}

export const serializedInventoryControlFlow = { dominatesControlFlow };

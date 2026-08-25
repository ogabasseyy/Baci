import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

function pathAt(source, targetIndex) {
  const searchable = serializedInventorySqlParser.maskSqlLiterals(source);
  const stack = [];
  const tokens =
    /\bEND\s+(?:IF|CASE|LOOP)\b|\bEND\b(?!\s+(?:IF|CASE|LOOP)\b)|\bEXCEPTION\s+WHEN\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b|\bELSIF\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b|\bWHEN\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b|\bELSE\b|\bIF\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b|\bCASE\b|\bWHILE\b(?:(?!\bLOOP\b)[\s\S])*?\bLOOP\b|\bFOR\s+[a-z_][a-z0-9_]*\s+IN\b(?:(?!\bLOOP\b)[\s\S])*?\bLOOP\b|\bLOOP\b|\bBEGIN\b/gi;
  for (const token of searchable.matchAll(tokens)) {
    if (token.index >= targetIndex) break;
    if (/^END\s+IF$/i.test(token[0]) && stack.at(-1)?.kind === 'if') {
      stack.pop();
    } else if (
      /^END\s+LOOP$/i.test(token[0]) &&
      stack.at(-1)?.kind === 'loop'
    ) {
      stack.pop();
    } else if (
      /^END(?:\s+CASE)?$/i.test(token[0]) &&
      ['case', 'block'].includes(stack.at(-1)?.kind)
    ) {
      stack.pop();
    } else if (/^(?:EXCEPTION\s+WHEN|ELSIF|WHEN|ELSE)\b/i.test(token[0])) {
      if (stack.length > 0) stack[stack.length - 1].branch = token.index;
    } else {
      stack.push({
        branch: token.index,
        id: token.index,
        kind: /^CASE$/i.test(token[0])
          ? 'case'
          : /LOOP$/i.test(token[0])
            ? 'loop'
            : /^BEGIN$/i.test(token[0])
              ? 'block'
              : 'if',
      });
    }
  }
  return stack.map(({ branch, id }) => `${id}:${branch}`);
}

function dominatesControlFlow(source, prerequisiteIndex, targetIndex) {
  const prerequisitePath = pathAt(source, prerequisiteIndex);
  const targetPath = pathAt(source, targetIndex);
  return prerequisitePath.every(
    (branch, index) => targetPath[index] === branch
  );
}

export const serializedInventoryControlFlow = { dominatesControlFlow };

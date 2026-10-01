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
      const normalizedToken = serializedInventorySqlParser
        .stripSqlComments(token[0])
        .trim();
      const zeroIterationLoop =
        /^(?:WHILE\s+\(*\s*(?:false|NOT\s+true)\s*\)*|FOR\s+[a-z_][a-z0-9_]*\s+IN\s+[\s\S]*\bWHERE\s+\(*\s*false\s*\)*\s*)LOOP$/i.test(
          normalizedToken
        );
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
        unreachable:
          zeroIterationLoop ||
          /^IF\s+(?:\(\s*)*(?:false(?:\s*::\s*(?:pg_catalog\s*\.\s*)?boolean)?|NOT\s+true)(?:\s*\))*\s+THEN$/i.test(
            normalizedToken
          ),
      });
    }
  }
  return stack.map(
    ({ branch, id, kind, unreachable }) =>
      `${kind}:${id}:${branch}:${unreachable}`
  );
}

const ifTokenAtPattern = /\bIF\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b/iy;
const constTrueIfPattern =
  /^IF\s+(?:\(\s*)*(?:true(?:\s*::\s*(?:pg_catalog\s*\.\s*)?boolean)?|NOT\s+false)(?:\s*\))*\s*THEN$/i;

function ifConditionAt(searchable, id) {
  ifTokenAtPattern.lastIndex = id;
  const token = ifTokenAtPattern.exec(searchable);
  ifTokenAtPattern.lastIndex = 0;
  return token?.[0] ?? null;
}

function isConstantTrueIf(searchable, id) {
  const token = ifConditionAt(searchable, id);
  if (!token) return false;
  return constTrueIfPattern.test(
    serializedInventorySqlParser.stripSqlComments(token).trim()
  );
}

function isReachable(source, index) {
  const terminator =
    /\bRETURN\b(?!\s+(?:NEXT|QUERY)\b)|\bRAISE\b(?!\s+(?:DEBUG|LOG|INFO|NOTICE|WARNING)\b)/gi;
  const loopExit = /\b(?:CONTINUE|EXIT)\b(?![^\n;]*\bWHEN\b)/gi;
  const statementStart = /(?:;|>>|\b(?:THEN|ELSE|LOOP|BEGIN)\b)$/i;
  const searchable = serializedInventorySqlParser.maskSqlLiterals(source);
  const target = pathAt(source, index);
  if (target.some((branch) => branch.endsWith(':true'))) return false;
  const killsTarget = (matchIndex) => {
    const terminatorPath = pathAt(source, matchIndex);
    const effective = [];
    for (const branch of terminatorPath) {
      const separator = branch.indexOf(':');
      const kind = branch.slice(0, separator);
      const [id, arm] = branch.slice(separator + 1).split(':');
      if (kind !== 'if' || id !== arm) {
        if (kind === 'if' && isConstantTrueIf(searchable, Number(id))) {
          return false;
        }
        effective.push(branch);
        continue;
      }
      if (!isConstantTrueIf(searchable, Number(id))) effective.push(branch);
    }
    return effective.every((branch, depth) => target[depth] === branch);
  };
  for (const match of searchable.slice(0, index).matchAll(terminator)) {
    if (killsTarget(match.index)) return false;
  }
  for (const match of searchable.slice(0, index).matchAll(loopExit)) {
    const before = searchable.slice(0, match.index).replace(/\s+$/, '');
    if (before !== '' && !statementStart.test(before)) continue;
    if (killsTarget(match.index)) return false;
  }
  return true;
}

function dominatesControlFlow(source, prerequisiteIndex, targetIndex) {
  if (prerequisiteIndex >= targetIndex) return false;
  const prerequisitePath = pathAt(source, prerequisiteIndex);
  const targetPath = pathAt(source, targetIndex);
  return (
    isReachable(source, prerequisiteIndex) &&
    isReachable(source, targetIndex) &&
    prerequisitePath.every((branch, index) => targetPath[index] === branch)
  );
}

function sharesInnermostLoop(source, ...indexes) {
  const loops = indexes.map((index) =>
    pathAt(source, index)
      .filter((branch) => branch.startsWith('loop:'))
      .at(-1)
  );
  return loops[0] !== undefined && loops.every((loop) => loop === loops[0]);
}

export const serializedInventoryControlFlow = {
  dominatesControlFlow,
  isReachable,
  sharesInnermostLoop,
};

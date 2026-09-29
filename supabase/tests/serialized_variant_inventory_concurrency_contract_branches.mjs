import assert from 'node:assert/strict';
import { serializedInventorySqlParser } from './serialized_variant_inventory_concurrency_contract_sql_parser.mjs';

function extractIfArms(source, openingPattern) {
  const normalized = serializedInventorySqlParser.stripSqlComments(source);
  const searchable = serializedInventorySqlParser.maskSqlLiterals(normalized, {
    preserveStrings: true,
  });
  const pattern = new RegExp(
    openingPattern.source,
    openingPattern.flags.replace('g', '').includes('m')
      ? openingPattern.flags.replace('g', '')
      : `${openingPattern.flags.replace('g', '')}m`
  );
  const opening = pattern.exec(searchable);
  assert.notEqual(opening, null, 'missing target IF branch');
  const tokenSource = serializedInventorySqlParser.maskSqlLiterals(normalized);
  const tokens =
    /\bEND\s+IF\b|\bEND\s+CASE\b|\bEND\b(?!\s+(?:IF|CASE|LOOP)\b)|\bELSIF\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b|\bELSE\b|\bIF\b(?:(?!\bTHEN\b)[\s\S])*?\bTHEN\b|\bCASE\b/gi;
  let depth = 0;
  let caseDepth = 0;
  let armStart = opening.index + opening[0].length;
  let arm = 'then';
  const arms = { thenBranch: '', elseBranch: undefined, elsifBranches: [] };
  for (const token of tokenSource.slice(opening.index).matchAll(tokens)) {
    const tokenIndex = opening.index + token.index;
    if (/^IF\b/i.test(token[0])) {
      depth += 1;
      continue;
    }
    if (/^END\s+CASE\b/i.test(token[0])) {
      caseDepth = Math.max(0, caseDepth - 1);
      continue;
    }
    if (/^END$/i.test(token[0])) {
      caseDepth = Math.max(0, caseDepth - 1);
      continue;
    }
    if (/^CASE\b/i.test(token[0])) {
      caseDepth += 1;
      continue;
    }
    if (/^END\s+IF\b/i.test(token[0])) {
      depth -= 1;
      if (depth === 0) {
        const finalArm = normalized.slice(armStart, tokenIndex);
        if (arm === 'then') arms.thenBranch = finalArm;
        else if (arm === 'else') arms.elseBranch = finalArm;
        else arms.elsifBranches.push(finalArm);
        return {
          thenBranch: arms.thenBranch,
          elseBranch: arms.elseBranch,
          elsifBranches: arms.elsifBranches,
        };
      }
      continue;
    }
    if (depth !== 1 || caseDepth !== 0) continue;
    const currentArm = normalized.slice(armStart, tokenIndex);
    if (arm === 'then') arms.thenBranch = currentArm;
    else if (arm === 'else') arms.elseBranch = currentArm;
    else arms.elsifBranches.push(currentArm);
    if (/^ELSE\b/i.test(token[0])) arm = 'else';
    else arm = 'elsif';
    armStart = tokenIndex + token[0].length;
  }
  assert.fail('unterminated target IF branch');
}

function extractIfBranches(source, openingPattern) {
  const branches = extractIfArms(source, openingPattern);
  assert.ok(
    branches.elseBranch !== undefined,
    'target IF branch is missing ELSE'
  );
  return branches;
}

export const serializedInventoryBranches = { extractIfArms, extractIfBranches };

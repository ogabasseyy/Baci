import assert from 'node:assert/strict';

function extractIfBranches(source, openingPattern) {
  const lines = source.split(/\r?\n/);
  const openingIndex = lines.findIndex((line) => openingPattern.test(line));
  assert.notEqual(openingIndex, -1, 'missing target IF branch');
  let depth = 1;
  let caseDepth = 0;
  let inElse = false;
  let currentLines;
  const thenLines = [];
  const elseLines = [];
  const elsifBranches = [];
  currentLines = thenLines;
  for (const line of lines.slice(openingIndex + 1)) {
    const sqlLine = line.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"/g, '');
    const caseTokens = sqlLine.matchAll(
      /\bEND\s+CASE\b|\bCASE\b|\bEND\b(?!\s+(?:IF|LOOP|CASE)\b)/gi
    );
    for (const token of caseTokens) {
      if (/^CASE$/i.test(token[0])) {
        caseDepth += 1;
      } else if (caseDepth > 0) {
        caseDepth -= 1;
      }
    }
    if (/^\s*IF\b/i.test(line)) {
      depth += 1;
    } else if (/^\s*END\s+IF\b/i.test(line)) {
      depth -= 1;
      if (depth === 0) {
        assert.ok(inElse, 'target IF branch is missing ELSE');
        return {
          thenBranch: thenLines.join('\n'),
          elseBranch: elseLines.join('\n'),
          elsifBranches: elsifBranches.map((branch) => branch.join('\n')),
        };
      }
    } else if (depth === 1 && caseDepth === 0 && /^\s*ELSIF\b/i.test(line)) {
      currentLines = [];
      elsifBranches.push(currentLines);
      continue;
    } else if (depth === 1 && caseDepth === 0 && /^\s*ELSE\b/i.test(line)) {
      inElse = true;
      currentLines = elseLines;
      continue;
    }
    currentLines.push(line);
  }
  assert.fail('unterminated target IF branch');
}

export const serializedInventoryBranches = { extractIfBranches };

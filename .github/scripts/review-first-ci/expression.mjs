// Test support: evaluates the small subset of GitHub Actions expressions used by the
// review-first CI workflows (==, !=, &&, ||, !, parentheses, string literals and
// startsWith / contains / fromJSON / always). Same approach as
// ci-private-runner-contract-utils.mjs: context values are substituted as JSON
// literals and the result is evaluated. GitHub compares strings case-insensitively,
// so equality operands are lower-cased. Context references with no supplied value
// evaluate to null, like a missing property in a real run.
import assert from 'node:assert/strict';

const SAFE = /^[\s()'"\w=!&|,.[\]\/\-:@${}+<>]+$/;
const ALLOWED_WORDS = new Set(['true', 'false', 'null', 'always', 'startsWith', 'contains']);

function lowerEqualityLiterals(source) {
  return source.replace(/((?:"[^"\\]*"|'[^'\\]*'))\s*(==|!=)\s*((?:"[^"\\]*"|'[^'\\]*'))/g, (_match, left, operator, right) => `${left.toLowerCase()} ${operator} ${right.toLowerCase()}`);
}

export function evaluateExpression(expression, values = {}) {
  let source = String(expression).trim();
  const wrapped = /^\$\{\{([\s\S]+)\}\}$/.exec(source);
  if (wrapped) source = wrapped[1];
  source = source.replace(/\s+/g, ' ');
  for (const key of Object.keys(values).sort((a, b) => b.length - a.length)) {
    const identifier = new RegExp(`(?<![\\w.])${key.replaceAll('.', '\\.')}(?![\\w])`, 'g');
    source = source.replace(identifier, () => JSON.stringify(values[key] ?? null));
  }
  source = source.replace(/(?<![\w.'"])(?:github|needs|vars|inputs|steps|env|runner)(?:\.[\w-]+)+/g, 'null');
  source = source.replace(/fromJSON\('([^']*)'\)/g, (_match, json) => JSON.stringify(JSON.parse(json)));
  source = lowerEqualityLiterals(source);
  assert.match(source, SAFE, `unsupported characters in expression: ${source}`);
  const outsideStrings = source.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  for (const word of outsideStrings.match(/[A-Za-z_]\w*/g) ?? []) {
    assert.ok(ALLOWED_WORDS.has(word), `unsupported word "${word}" in expression: ${source}`);
  }
  const always = () => true;
  const startsWith = (text, prefix) => String(text ?? '').toLowerCase().startsWith(String(prefix ?? '').toLowerCase());
  const contains = (haystack, needle) =>
    Array.isArray(haystack)
      ? haystack.some((entry) => String(entry).toLowerCase() === String(needle).toLowerCase())
      : String(haystack ?? '').toLowerCase().includes(String(needle ?? '').toLowerCase());
  // The workflow files are repository code that these tests already trust; the
  // character check above is a typo guard, not a sandbox.
  return Function('always', 'startsWith', 'contains', `"use strict"; return (${source});`)(always, startsWith, contains);
}

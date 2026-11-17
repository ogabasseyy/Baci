// Regression test for .github/workflows/muse-comment-review.yml concurrency & job-gating truth table.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const WORKFLOW_PATH = resolve('.github/workflows/muse-comment-review.yml');
const workflowText = readFileSync(WORKFLOW_PATH, 'utf8');

function extractScalarAfter(label) {
  const lines = workflowText.split(/\r?\n/);
  const idx = lines.findIndex((line) => line.trim().startsWith(`${label}:`));
  assert.notEqual(idx, -1, `Expected to find "${label}:" in workflow`);
  const keyIndent = lines[idx].length - lines[idx].trimStart().length;
  const value = lines[idx].slice(lines[idx].indexOf(':') + 1).trim();
  if (value === '>-' || value === '>') {
    const collected = [];
    for (let i = idx + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.trim() === '') continue;
      const indent = line.length - line.trimStart().length;
      if (indent <= keyIndent) break;
      collected.push(line.trim());
    }
    return collected.join(' ');
  }
  return value;
}

function unwrapExpr(raw) {
  const m = raw.match(/^\$\{\{\s*(.*?)\s*\}\}$/);
  return m ? m[1] : raw;
}

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (expr.startsWith('&&', i) || expr.startsWith('||', i) || expr.startsWith('==', i) || expr.startsWith('!=', i)) {
      tokens.push({ type: 'op', value: expr.slice(i, i + 2) });
      i += 2;
    } else if ('()!,'.includes(ch)) {
      tokens.push({ type: ch, value: ch });
      i += 1;
    } else if (ch === "'") {
      let j = i + 1;
      let str = '';
      while (j < expr.length && expr[j] !== "'") {
        str += expr[j];
        j += 1;
      }
      tokens.push({ type: 'str', value: str });
      i = j + 1;
    } else if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < expr.length && /[0-9]/.test(expr[j])) j += 1;
      tokens.push({ type: 'num', value: Number(expr.slice(i, j)) });
      i = j;
    } else {
      let j = i;
      while (j < expr.length && /[A-Za-z0-9_.]/.test(expr[j])) j += 1;
      tokens.push({ type: 'id', value: expr.slice(i, j) });
      i = j;
    }
  }
  return tokens;
}

function evalWorkflowPredicate(expr, ctx) {
  const tokens = tokenize(expr);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  const env = {
    null: null,
    'github.event.issue.pull_request': ctx.pull_request ?? null,
    'github.event.comment.body': ctx.comment_body ?? '',
    'github.event.comment.author_association': ctx.author_association ?? 'NONE',
    'github.run_attempt': ctx.run_attempt ?? 1,
  };

  function parseOr() {
    let left = parseAnd();
    while (peek()?.value === '||') {
      next();
      const right = parseAnd();
      left = left || right;
    }
    return left;
  }

  function parseAnd() {
    let left = parseEq();
    while (peek()?.value === '&&') {
      next();
      const right = parseEq();
      left = left && right;
    }
    return left;
  }

  function parseEq() {
    let left = parseUnary();
    while (peek()?.value === '==' || peek()?.value === '!=') {
      const op = next().value;
      const right = parseUnary();
      left = op === '==' ? left === right : left !== right;
    }
    return left;
  }

  function parseUnary() {
    if (peek()?.type === '!') {
      next();
      return !parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const tok = next();
    assert.ok(tok, `Unexpected end of expression: ${expr}`);
    if (tok.type === '(') {
      const val = parseOr();
      assert.equal(next()?.type, ')');
      return val;
    }
    if (tok.type === 'str' || tok.type === 'num') return tok.value;
    if (tok.type === 'id') {
      if (tok.value === 'startsWith' && peek()?.type === '(') {
        next();
        const haystack = String(parseOr());
        assert.equal(next()?.type, ',');
        const needle = String(parseOr());
        assert.equal(next()?.type, ')');
        return haystack.toLowerCase().startsWith(needle.toLowerCase());
      }
      assert.ok(tok.value in env, `Unknown identifier "${tok.value}" in ${expr}`);
      return env[tok.value];
    }
    assert.fail(`Unexpected token ${JSON.stringify(tok)}`);
  }

  return parseOr();
}

const groupLine = extractScalarAfter('group');
const cancelRaw = unwrapExpr(extractScalarAfter('cancel-in-progress'));
const jobIfRaw = extractScalarAfter('if');

const groupExprMatch = groupLine.match(/\$\{\{\s*(!(?:.*?))\s*\}\}$/);
assert.ok(groupExprMatch, 'Expected inverted group suffix ternary expression in concurrency.group');
const groupSuffixExpr = groupExprMatch[1];

function evaluateRouting(ctx) {
  const suffix = evalWorkflowPredicate(groupSuffixExpr, ctx);
  return {
    group: `muse-comment-review-${ctx.issue_number}-attempt-${ctx.run_attempt ?? 1}${suffix}`,
    cancelInProgress: Boolean(evalWorkflowPredicate(cancelRaw, ctx)),
    jobRuns: Boolean(evalWorkflowPredicate(jobIfRaw, ctx)),
  };
}

test('legitimate @muse review comment enters live concurrency group with cancel-in-progress=true', () => {
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    for (const body of ['@muse review', '@MUSE review\r\n', '@muse review\n@codex review']) {
      const result = evaluateRouting({
        issue_number: 4322,
        pull_request: { url: 'https://example.test/pulls/4322' },
        comment_body: body,
        author_association: association,
        run_attempt: 1,
      });
      assert.equal(result.group, 'muse-comment-review-4322-attempt-1', `${association} ${JSON.stringify(body)}`);
      assert.equal(result.cancelInProgress, true);
      assert.equal(result.jobRuns, true);
    }
  }
});

test('non-triggering comments (@codex review, CodeRabbit, quotes, untrusted authors, issues) land in -ignored without cancelling', () => {
  const nonTriggers = [
    { pull_request: { url: 'x' }, comment_body: '@codex review', author_association: 'OWNER' },
    { pull_request: { url: 'x' }, comment_body: 'CodeRabbit summary', author_association: 'CONTRIBUTOR' },
    { pull_request: { url: 'x' }, comment_body: 'Please wait before running @muse review', author_association: 'OWNER' },
    { pull_request: { url: 'x' }, comment_body: '\n@muse review', author_association: 'OWNER' },
    { pull_request: { url: 'x' }, comment_body: '@muse review', author_association: 'NONE' },
    { pull_request: null, comment_body: '@muse review', author_association: 'OWNER' },
  ];

  for (const scenario of nonTriggers) {
    const result = evaluateRouting({ issue_number: 4322, run_attempt: 1, ...scenario });
    assert.equal(result.group, 'muse-comment-review-4322-attempt-1-ignored', JSON.stringify(scenario));
    assert.equal(result.cancelInProgress, false, JSON.stringify(scenario));
    assert.equal(result.jobRuns, false, JSON.stringify(scenario));
  }
});

test('manual rerun attempt >= 2 never cancels in-flight attempt 1', () => {
  const result = evaluateRouting({
    issue_number: 4322,
    pull_request: { url: 'x' },
    comment_body: '@muse review',
    author_association: 'OWNER',
    run_attempt: 2,
  });
  assert.equal(result.group, 'muse-comment-review-4322-attempt-2');
  assert.equal(result.cancelInProgress, false);
  assert.equal(result.jobRuns, true);
});

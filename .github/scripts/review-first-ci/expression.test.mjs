import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluateExpression } from './expression.mjs';

describe('evaluateExpression', () => {
  it('substitutes context values and compares strings case-insensitively', () => {
    assert.equal(evaluateExpression("github.event_name == 'Pull_Request'", { 'github.event_name': 'pull_request' }), true);
    assert.equal(evaluateExpression("github.event_name != 'push'", { 'github.event_name': 'pull_request' }), true);
  });

  it('supports the ternary idiom of && and ||', () => {
    const expression = "${{ github.ok == 'yes' && 'Build' || 'Build (deferred)' }}";
    assert.equal(evaluateExpression(expression, { 'github.ok': 'yes' }), 'Build');
    assert.equal(evaluateExpression(expression, { 'github.ok': 'no' }), 'Build (deferred)');
  });

  it('treats an unknown context reference as null', () => {
    assert.equal(evaluateExpression("github.event.pull_request.head.repo.full_name != github.repository", { 'github.repository': 'o/r' }), true);
    assert.equal(evaluateExpression("needs.changes.outputs.stage == 'full'", {}), false);
  });

  it('supports negation, grouping and always()', () => {
    assert.equal(evaluateExpression("!(github.a == 'x' && (vars.b == 'on' || vars.b == 'pilot'))", { 'github.a': 'x', 'vars.b': 'pilot' }), false);
    assert.equal(evaluateExpression('${{ always() }}'), true);
  });

  it('supports startsWith, contains and fromJSON for the nudge workflow filters', () => {
    assert.equal(evaluateExpression("startsWith(github.event.comment.body, '/ci-now')", { 'github.event.comment.body': '/ci-now please' }), true);
    assert.equal(evaluateExpression('contains(fromJSON(\'["OWNER","MEMBER"]\'), github.assoc)', { 'github.assoc': 'member' }), true);
    assert.equal(evaluateExpression('contains(fromJSON(\'["OWNER","MEMBER"]\'), github.assoc)', { 'github.assoc': 'NONE' }), false);
  });

  it('rejects characters outside the supported subset', () => {
    assert.throws(() => evaluateExpression('process.exit(1)'), /unsupported|not defined|ReferenceError/);
  });
});

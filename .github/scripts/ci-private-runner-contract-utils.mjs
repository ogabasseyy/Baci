import assert from 'node:assert/strict';

function evaluate(expression, values) {
  assert.match(expression, /^\$\{\{[\s\S]+\}\}$/);
  let source = expression.slice(3, -2);
  for (const [key, value] of Object.entries(values)) {
    const identifier = new RegExp(`(?<![\\w.])${key.replaceAll('.', '\\.')}(?![\\w.])`, 'g');
    source = source.replace(identifier, JSON.stringify(value));
  }
  source = source.replace(/fromJSON\('([^']+)'\)/g, (_match, json) =>
    JSON.stringify(JSON.parse(json))
  );
  // GitHub compares strings case-insensitively. Normalize only literals that
  // participate in equality tests, leaving returned runner label arrays intact.
  // Escaped quotes are not supported; extend this if the workflow uses them.
  source = source.replace(/((?:"[^"\\]*"|'[^'\\]*'))\s*(==|!=)\s*((?:"[^"\\]*"|'[^'\\]*'))/g,
    (_match, left, operator, right) => `${left.toLowerCase()} ${operator} ${right.toLowerCase()}`);
  assert.match(source, /^[\s()'"\w=!&|,.[\]\/\-]+$/);
  // This executes the checked-out workflow expression, which these tests trust
  // as repository code; the character check is not a security sandbox.
  return Function(`"use strict"; return (${source});`)();
}

// Evaluate GitHub's base job output and a dependent job's actual expression.
export function privateRunnerRoute(workflow, job, values, field = 'runs-on') {
  const trusted = evaluate(workflow.jobs.changes.outputs.private_ci_trusted, values);
  return privateRunnerRouteWithTrust(workflow, job, values, String(trusted), field);
}

export function privateRunnerRouteWithTrust(workflow, job, values, trusted, field = 'runs-on') {
  return evaluate(workflow.jobs[job][field], {
    ...values,
    'needs.changes.outputs.private_ci_trusted': trusted,
  });
}

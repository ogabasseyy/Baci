import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from '@typescript/typescript6';

const directory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(directory, '..', '..');

function eventPipelineClientIsUsed(source, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );
  const declarations = [];
  function collect(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'createServiceClient' &&
      ts.isStringLiteral(node.initializer.arguments[0]) &&
      node.initializer.arguments[0].text === 'event-pipeline'
    )
      declarations.push(node);
    ts.forEachChild(node, collect);
  }
  collect(sourceFile);

  function scopeOf(node) {
    let current = node.parent;
    while (
      current &&
      !ts.isSourceFile(current) &&
      !ts.isBlock(current) &&
      !ts.isFunctionLike(current)
    )
      current = current.parent;
    return current ?? sourceFile;
  }
  function isAncestor(ancestor, node) {
    for (let current = node; current; current = current.parent)
      if (current === ancestor) return true;
    return false;
  }
  function bindingAt(name, at) {
    let best;
    function visit(node) {
      if (
        (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name &&
        node.pos < at.pos &&
        isAncestor(scopeOf(node), at) &&
        (!best || node.pos > best.pos)
      )
        best = node;
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    return best;
  }
  let used = false;
  function findUse(node) {
    if (
      ts.isIdentifier(node) &&
      !(
        (ts.isVariableDeclaration(node.parent) ||
          ts.isParameter(node.parent)) &&
        node.parent.name === node
      ) &&
      declarations.some(
        (declaration) =>
          node !== declaration.name &&
          node.text === declaration.name.text &&
          bindingAt(node.text, node) === declaration
      )
    )
      used = true;
    ts.forEachChild(node, findUse);
  }
  findUse(sourceFile);
  return declarations.length > 0 && used;
}

test('client-use detector ignores shadowed identifiers', () => {
  assert.equal(
    eventPipelineClientIsUsed(
      "const client = createServiceClient('event-pipeline'); function run(client) { return client.rpc('other'); }",
      'shadowed.ts'
    ),
    false
  );
});

for (const [wrapper, script] of [
  ['process-domain-events.sh', 'src/scripts/process-domain-events.ts'],
  ['process-event-deliveries.sh', 'src/scripts/process-event-deliveries.ts'],
]) {
  test(`${wrapper} uses the hardened shared web runner`, () => {
    const source = readFileSync(join(directory, wrapper), 'utf8');
    assert.match(source, /set -euo pipefail/);
    assert.match(source, /run-web-script\.sh/);
    assert.match(
      source,
      /BACI_WORKER_PROFILE="\$\{BACI_WORKER_PROFILE:-event-pipeline\}"/
    );
    assert.match(source, new RegExp(script.replaceAll('/', '\\/')));
    assert.match(source, /"\$@"/);
    assert.doesNotMatch(source, /\.rpc\s*\(/);

    const entrypoint = readFileSync(
      join(repositoryRoot, 'apps', 'web', script),
      'utf8'
    );
    assert.equal(eventPipelineClientIsUsed(entrypoint, script), true);
  });
}

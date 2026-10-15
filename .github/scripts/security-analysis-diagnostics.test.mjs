import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../workflows/security.yml', import.meta.url), 'utf8');
const body = workflow.split("python3 - <<'PYTHON'\n")[1]?.split('          PYTHON')[0];
assert.ok(body, 'execute the actual workflow validator');
const python = body.replace(/^          /gm, '');

function validate(report, { empty = false, sarif = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baci-semgrep-diagnostics-'));
  try {
    if (report !== undefined) writeFileSync(join(root, 'semgrep.raw.json'), typeof report === 'string' ? report : JSON.stringify(report));
    if (sarif) writeFileSync(join(root, 'semgrep.sarif'), '{"runs":[]}');
    const result = spawnSync('python3', ['-c', python], { cwd: root, encoding: 'utf8', env: { ...process.env, EMPTY_PR_SCOPE: String(empty) } });
    if (sarif && !empty) assert.equal(readFileSync(join(root, 'semgrep.raw.sarif'), 'utf8'), '{"runs":[]}');
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const complete = { errors: [], paths: { scanned: ['probe.ts'] } };
test('complete zero-error analysis passes and preserves unfiltered SARIF', () => {
  assert.equal(validate(complete).status, 0);
});
for (const [name, report] of [
  ['missing', undefined], ['malformed', '{'], ['null', null],
  ['missing diagnostics', {}], ['no scanned files', { errors: [], paths: { scanned: [] } }],
  ['warning parse error', { ...complete, errors: [{ level: 'warn', type: 'PartialParsing', message: 'PRIVATE_SOURCE_SNIPPET' }] }],
  ['internal scanner error', { ...complete, errors: [{ level: 'error', type: 'InternalError' }] }],
]) {
  test(`${name} fails closed without logging source snippets`, () => {
    const result = validate(report);
    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_SOURCE_SNIPPET/);
  });
}
test('missing SARIF fails even with valid diagnostics', () => {
  assert.notEqual(validate(complete, { sarif: false }).status, 0);
});
test('explicit empty PR scope can skip without scanner output', () => {
  assert.equal(validate(undefined, { empty: true, sarif: false }).status, 0);
});
test('all scan modes retain raw diagnostics and enforce warning errors', () => {
  assert.equal((workflow.match(/--json-output=semgrep\.raw\.json/g) ?? []).length, 3);
  assert.equal((workflow.match(/semgrep scan --error --strict/g) ?? []).length, 2);
  assert.match(workflow, /semgrep ci --no-suppress-errors/);
  assert.match(workflow, /name: Preserve unfiltered Semgrep diagnostics\n        if: always\(\)/);
  assert.match(workflow, /if-no-files-found: error/);
});

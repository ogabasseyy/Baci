import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../workflows/security.yml', import.meta.url), 'utf8');
const body = workflow.split("python3 - <<'PYTHON'\n")[1]?.split('          PYTHON')[0];
assert.ok(body, 'execute the actual workflow validator');
const python = body.replace(/^          /gm, '');

function validate(report, { empty = false, sarif = true, requested = ['probe.ts'], event = 'pull_request' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baci-semgrep-diagnostics-'));
  try {
    if (report !== undefined) writeFileSync(join(root, 'semgrep.raw.json'), typeof report === 'string' ? report : JSON.stringify(report));
    if (requested !== null) writeFileSync(join(root, 'semgrep.requested-targets'), typeof requested === 'string' ? requested : requested.join('\0') + '\0');
    if (sarif) writeFileSync(join(root, 'semgrep.sarif'), '{"runs":[]}');
    const result = spawnSync('python3', ['-c', python], { cwd: root, encoding: 'utf8', env: { ...process.env, EMPTY_PR_SCOPE: String(empty), SCAN_EVENT_NAME: event } });
    if (sarif && !empty) assert.equal(readFileSync(join(root, 'semgrep.raw.sarif'), 'utf8'), '{"runs":[]}');
    if (!empty) {
      const status = JSON.parse(readFileSync(join(root, 'semgrep.analysis-status.json'), 'utf8'));
      assert.equal(status.status, result.status === 0 ? 'complete' : 'incomplete');
    }
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
  assert.match(workflow, /            semgrep\.analysis-status\.json/);
});

test('base filter checkout precedes fail-closed diagnostics validation', () => {
  assert.ok(workflow.indexOf('- name: Checkout base filter implementation') < workflow.indexOf('- name: Verify complete Semgrep analysis'));
  assert.ok(workflow.indexOf('- name: Verify complete Semgrep analysis') < workflow.indexOf('- name: Drop audited checkout finding from SARIF'));
});

test('shell scripts read GitHub context through environment variables', () => {
  for (const block of workflow.split('        run: |\n').slice(1)) {
    const script = block.split(/\n(?=        [a-z]|      - |  [a-z])/)[0];
    assert.doesNotMatch(script, /\$\{\{/);
  }
  assert.match(workflow, /PR_BASE_REF: \$\{\{ github.event.pull_request.base.ref \}\}/);
});

test('targeted and protected-branch scans use the existing full CI engine', () => {
  assert.equal((workflow.match(/semgrep install-semgrep-pro/g) ?? []).length, 2);
  assert.equal((workflow.match(/semgrep scan --error --strict --pro-intrafile --config auto/g) ?? []).length, 2);
});

test('a silently skipped requested target fails even when another file was scanned', () => {
  assert.notEqual(validate(complete, { requested: ['probe.ts', 'oversized.ts'] }).status, 0);
});
test('protected-branch scans require coverage of every requested source path', () => {
  assert.notEqual(validate(complete, { requested: ['probe.ts', 'oversized.ts'], event: 'push' }).status, 0);
});
test('missing requested-target manifest fails closed on targeted scans', () => {
  assert.notEqual(validate(complete, { requested: null }).status, 0);
});
test('reported skipped targets fail closed', () => {
  assert.notEqual(validate({ ...complete, paths: { ...complete.paths, skipped: [{ path: 'oversized.ts', reason: 'exceeded_size_limit' }] } }).status, 0);
});
test('a complete requested set including whitespace paths passes', () => {
  assert.equal(validate({ errors: [], paths: { scanned: ['probe.ts', 'space name.ts'] } }, { requested: ['probe.ts', 'space name.ts'] }).status, 0);
});

test('an unterminated requested-target manifest fails closed', () => {
  assert.notEqual(validate(complete, { requested: 'probe.ts' }).status, 0);
});
test('protected-branch manifest includes tracked source files with spaces', () => {
  const root = mkdtempSync(join(tmpdir(), 'baci-semgrep-push-scope-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
    for (const path of ['apps/web/src/lib/probe.ts', 'apps/web/src/lib/space name.ts', 'apps/web/src/lib/config.json', 'outside.ts']) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), 'fixture');
    }
    assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);
    const producer = workflow.split("<<'PYTARGETS'\n")[1].split('          PYTARGETS')[0].replace(/^          /gm, '');
    const targets = workflow.split('          scan_targets=(\n')[1].split('          )')[0].trim().split(/\s+/);
    const result = spawnSync('python3', ['-c', producer, ...targets], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_WORKSPACE: root } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(join(root, 'semgrep.requested-targets'), 'utf8').split('\0').filter(Boolean).sort(), ['apps/web/src/lib/probe.ts', 'apps/web/src/lib/space name.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

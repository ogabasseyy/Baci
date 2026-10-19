import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';
import { fileURLToPath } from 'node:url';

const workflow = readFileSync(new URL('../workflows/security.yml', import.meta.url), 'utf8');
const helper = fileURLToPath(new URL('./semgrep-sarif-analysis-diagnostics.py', import.meta.url));

function validate(report, { empty = false, sarif = true, requested = ['probe.ts'], event = 'pull_request' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baci-semgrep-diagnostics-'));
  try {
    if (report !== undefined) writeFileSync(join(root, 'semgrep.raw.json'), typeof report === 'string' ? report : JSON.stringify(report));
    if (requested !== null) writeFileSync(join(root, 'semgrep.requested-targets'), typeof requested === 'string' ? requested : requested.join('\0') + '\0');
    if (sarif) writeFileSync(join(root, 'semgrep.sarif'), '{"runs":[]}');
    const result = spawnSync('python3', [helper, 'validate'], { cwd: root, encoding: 'utf8', env: { ...process.env, EMPTY_PR_SCOPE: String(empty), SCAN_EVENT_NAME: event } });
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

const complete = { results: [], errors: [], paths: { scanned: ['probe.ts'] } };
test('complete zero-error analysis passes and preserves unfiltered SARIF', () => {
  assert.equal(validate(complete).status, 0);
});
for (const [name, report] of [
  ['missing', undefined], ['malformed', '{'], ['null', null],
  ['missing diagnostics', {}], ['missing results', { errors: [], paths: { scanned: ['probe.ts'] } }],
  ['non-list results', { ...complete, results: {} }], ['non-list skipped', { ...complete, paths: { ...complete.paths, skipped: {} } }],
  ['no scanned files', { results: [], errors: [], paths: { scanned: [] } }],
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

test('base filter checkout precedes fail-closed diagnostics validation and PR target selection runs without tokens', () => {
  assert.ok(workflow.indexOf('- name: Select targeted Semgrep PR files') < workflow.indexOf('- name: Run targeted Semgrep for security-relevant PR changes'));
  assert.ok(workflow.indexOf('- name: Run targeted Semgrep for security-relevant PR changes') < workflow.indexOf('- name: Checkout base filter implementation'));
  assert.ok(workflow.indexOf('- name: Checkout base filter implementation') < workflow.indexOf('- name: Verify complete Semgrep analysis'));
  assert.ok(workflow.indexOf('- name: Verify complete Semgrep analysis') < workflow.indexOf('- name: Drop audited checkout finding from SARIF'));
  const parsedWorkflow = parse(workflow);
  const steps = parsedWorkflow.jobs.semgrep.steps;
  const selectorStep = steps.find((step) => step.name === 'Select targeted Semgrep PR files');
  const validateStep = steps.find((step) => step.name === 'Verify complete Semgrep analysis and preserve raw SARIF');
  const scanStep = steps.find((step) => step.name === 'Run targeted Semgrep for security-relevant PR changes');
  assert.deepEqual(Object.keys(selectorStep.env ?? {}), ['PR_BASE_REF']);
  assert.match(selectorStep.run, /git show "origin\/\$\{PR_BASE_REF\}:\$\{diagnostics_helper\}"/);
  assert.ok(!('SEMGREP_APP_TOKEN' in (validateStep.env ?? {})) && !('GITHUB_TOKEN' in (validateStep.env ?? {})));
  assert.match(validateStep.run, /base-filter\/\$\{diagnostics_helper\}/);
  assert.doesNotMatch(scanStep.run, /semgrep-sarif-analysis-diagnostics\.py/);
});

test('shell scripts read GitHub context through environment variables', () => {
  for (const block of workflow.split('        run: |\n').slice(1)) {
    const script = block.split(/\n(?=        [a-z]|      - |  [a-z])/)[0];
    assert.doesNotMatch(script, /\$\{\{/);
  }
  assert.match(workflow, /PR_BASE_REF: \$\{\{ github.event.pull_request.base.ref \}\}/);
});

test('targeted and protected-branch scans use the existing full CI engine', () => {
  const steps = parse(workflow).jobs.semgrep.steps;
  for (const id of ['semgrep_pr', 'semgrep_push']) {
    const step = steps.find((entry) => entry.id === id);
    assert.match(step.run, /semgrep install-semgrep-pro/);
    assert.match(step.run, /semgrep scan --error --strict --pro-intrafile --config auto/);
  }
  assert.equal((workflow.match(/semgrep scan --error --strict --pro-intrafile --config auto/g) ?? []).length, 2);
});

test('every required scan gives each rule 15 seconds without relaxing failures', () => {
  const steps = parse(workflow).jobs.semgrep.steps;
  for (const id of ['semgrep_pr', 'semgrep_push', 'semgrep_full']) {
    const step = steps.find((entry) => entry.id === id);
    assert.ok(step, `${id} must remain present`);
    assert.match(step.run, /--timeout 15(?: |$)/);
    assert.doesNotMatch(step.run, /--timeout-threshold|--no-strict|--suppress-errors/);
  }
  assert.equal((workflow.match(/--timeout 15/g) ?? []).length, 3);
  assert.equal((workflow.match(/semgrep scan --error --strict --pro-intrafile --config auto/g) ?? []).length, 2);
  assert.match(workflow, /semgrep ci --no-suppress-errors/);
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
test('reported skipped targets fail closed on manifest-verified scans', () => {
  assert.notEqual(validate({ ...complete, paths: { ...complete.paths, skipped: [{ path: 'oversized.ts', reason: 'exceeded_size_limit' }] } }).status, 0);
});
test('scheduled full scans allow skipped non-manifest files when diagnostics and SARIF are complete', () => {
  assert.equal(validate({ ...complete, paths: { ...complete.paths, skipped: [{ path: 'vendor/bundle.min.js', reason: 'semgrepignore_patterns_match' }] } }, { requested: null, event: 'schedule' }).status, 0);
});
test('a complete requested set including whitespace paths passes', () => {
  assert.equal(validate({ results: [], errors: [], paths: { scanned: ['probe.ts', 'space name.ts'] } }, { requested: ['probe.ts', 'space name.ts'] }).status, 0);
});

test('an unterminated requested-target manifest fails closed', () => {
  assert.notEqual(validate(complete, { requested: 'probe.ts' }).status, 0);
});
test('protected-branch manifest includes tracked source files with spaces', () => {
  const root = mkdtempSync(join(tmpdir(), 'baci-semgrep-push-scope-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
    for (const path of ['apps/web/src/lib/probe.ts', 'apps/web/src/lib/space name.ts', 'apps/web/src/lib/config.json', 'apps/web/src/lib/probe.py', '.github/scripts/semgrep-sarif-analysis-diagnostics.py', '.github/scripts/semgrep-sarif-pg-diagnostic.py', '.github/scripts/semgrep-sarif-pg-diagnostic.test.py', 'next.config.ts', 'packages/shared/scripts/check-module-size.mjs', 'packages/shared/scripts/check-module-size-report.mjs', 'scripts/local-only.mjs', 'outside.ts']) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), 'fixture');
    }
    assert.equal(spawnSync('git', ['add', '.'], { cwd: root }).status, 0);
    const targets = workflow.split('          scan_targets=(\n')[1].split('          )')[0].trim().split(/\s+/);
    const result = spawnSync('python3', [helper, 'push-targets', ...targets], { cwd: root, encoding: 'utf8', env: { ...process.env, GITHUB_WORKSPACE: root } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readFileSync(join(root, 'semgrep.requested-targets'), 'utf8').split('\0').filter(Boolean).sort(), ['.github/scripts/semgrep-sarif-analysis-diagnostics.py', '.github/scripts/semgrep-sarif-pg-diagnostic.py', '.github/scripts/semgrep-sarif-pg-diagnostic.test.py', 'apps/web/src/lib/probe.ts', 'apps/web/src/lib/space name.ts', 'next.config.ts', 'packages/shared/scripts/check-module-size-report.mjs', 'packages/shared/scripts/check-module-size.mjs']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workflow, diagnostics and scope changes trigger their regression suite', () => {
  const filters = parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  for (const path of ['.github/workflows/security.yml', '.github/scripts/semgrep-sarif-analysis-diagnostics.py', '.github/scripts/security-analysis-diagnostics.test.mjs', '.github/scripts/security-pr-scope.test.mjs']) {
    assert.ok(filters.quiz_db.includes(path), `${path} must trigger coverage regressions`);
  }
});

// Git check-ignore is a Gitignore syntax proxy, not an actual Semgrep scan.
// Actual pinned Semgrep target selection was also verified independently.
test('Gitignore proxy restores only the two required shared scripts', () => {
  const root = mkdtempSync(join(tmpdir(), 'baci-semgrep-ignore-'));
  try {
    assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
    writeFileSync(join(root, '.git/info/exclude'), readFileSync(new URL('../../.semgrepignore', import.meta.url)));
    for (const path of ['scripts/local-only.mjs', 'apps/web/scripts/local-only.mjs', 'packages/shared/scripts/other.mjs', 'packages/shared/scripts/nested/local-only.mjs', 'packages/shared/scripts/check-module-size.mjs', 'packages/shared/scripts/check-module-size-report.mjs']) {
      mkdirSync(join(root, path, '..'), { recursive: true });
      writeFileSync(join(root, path), 'fixture');
      const result = spawnSync('git', ['check-ignore', '--no-index', path], { cwd: root, encoding: 'utf8' });
      const restored = ['packages/shared/scripts/check-module-size.mjs', 'packages/shared/scripts/check-module-size-report.mjs'].includes(path);
      assert.equal(result.status, restored ? 1 : 0, `${path}: ${result.stdout}${result.stderr}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('optional synthetic PostgreSQL scanner diagnostic preserves its isolation contracts', () => {
  const diagnosticTest = fileURLToPath(new URL('./semgrep-sarif-pg-diagnostic.test.py', import.meta.url));
  const result = spawnSync('python3', [diagnosticTest], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('optional PostgreSQL diagnostic changes trigger their regression suite', () => {
  const filters = parse(readFileSync(new URL('../filters/ci.yml', import.meta.url), 'utf8'));
  for (const path of ['.github/scripts/semgrep-sarif-pg-diagnostic.py', '.github/scripts/semgrep-sarif-pg-diagnostic.test.py']) {
    assert.ok(filters.quiz_db.includes(path), `${path} must trigger diagnostic regressions`);
  }
});


test('optional diagnostic failure emits a warning while required scan failures remain enforced', () => {
  const steps = parse(workflow).jobs.semgrep.steps;
  const warning = steps.find((step) => step.name === 'Warn if optional PostgreSQL diagnostics failed');
  assert.match(warning.if, /steps\.pg_diagnostic\.outcome == 'failure'/);
  assert.match(warning.if, /steps\.pg_diagnostic_upload\.outcome == 'failure'/);
  assert.match(warning.run, /::warning::/);
  assert.doesNotMatch(warning.run, /\$\{\{/);
  const failGate = steps.find((step) => step.name === 'Fail on Semgrep findings or scanner errors');
  assert.match(failGate.if, /steps\.semgrep_full\.outcome == 'failure'/);
  assert.doesNotMatch(failGate.if, /pg_diagnostic/);
  assert.equal(failGate.run, 'exit 1');
});

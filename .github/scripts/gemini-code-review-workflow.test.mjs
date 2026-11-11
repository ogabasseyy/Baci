// Contract test for .github/workflows/gemini-code-review.yml: who may trigger it, where its code
// comes from, which step sees which secret, and that a Gemini outage can never read as a finding.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test, { describe } from 'node:test';
import YAML from 'yaml';
import { DEFAULT_MODEL } from './gemini-review/api.mjs';

const text = readFileSync('.github/workflows/gemini-code-review.yml', 'utf8');
const workflow = YAML.parse(text);
const job = workflow.jobs['gemini-review'];
const steps = job.steps;
const step = (name) => steps.find((candidate) => candidate.name === name);
const stepEnv = (name) => step(name).env ?? {};
const SCRIPT_STEPS = {
  'Collect PR diff and build prompt': 'collect.sh',
  'Decide whether to call Gemini': 'decide.mjs',
  'Review with Gemini': 'call.mjs',
  'Report Gemini review': 'post.mjs',
};

test('keeps the trigger rules: non-draft same-repo pull requests, or a trusted author commenting the command', () => {
  assert.deepEqual(workflow.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'ready_for_review']);
  assert.deepEqual(workflow.on.issue_comment.types, ['created']);
  assert.deepEqual(workflow.permissions, { contents: 'read', 'pull-requests': 'write', statuses: 'write' });
  const condition = job.if.replace(/\s+/g, ' ');
  assert.match(condition, /github\.event\.pull_request\.draft == false/);
  assert.match(condition, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) assert.ok(condition.includes(`'${association}'`));
  assert.ok(!condition.includes("'CONTRIBUTOR'") && !condition.includes("'NONE'"));
  assert.equal(job.name, 'Gemini review');
});

test('contract: uses a current default model that matches the script default, never the retired one', () => {
  const fallback = /\|\| '([^']+)'/.exec(job.env.GEMINI_MODEL_RESOLVED)?.[1];
  assert.equal(fallback, DEFAULT_MODEL);
  assert.ok(!/gemini-3\.7-flash|gemini-3\.5-flash(?!-lite)|gemini-2\.0|gemini-1\./.test(text.replace(/#.*$/gm, '')));
});

test('contract: one direct API request, with no agent, no tools and no third-party action', () => {
  const uses = steps.map((candidate) => candidate.uses).filter(Boolean);
  assert.ok(uses.length > 0 && uses.every((value) => /^actions\/checkout@[0-9a-f]{40}$/.test(value)), `unexpected actions: ${uses}`);
  assert.ok(!/run-gemini-cli|GEMINI_CLI_TRUST_WORKSPACE|YOLO/.test(text));
  assert.ok(!/^\s+gemini_api_key:/m.test(text), 'the action input form of the key must not come back');
});

test('contract: scripts come from the default branch, never from the pull request under review', () => {
  const trusted = step('Checkout trusted review scripts');
  assert.equal(trusted.with.ref, '${{ github.event.repository.default_branch }}');
  assert.equal(trusted.with.path, 'trusted-scripts');
  assert.equal(trusted.with['sparse-checkout'], '.github/scripts/gemini-review');
  assert.equal(trusted.with['persist-credentials'], false);
  assert.match(step('Clear trusted-scripts path').run, /rm -rf "\$\{GITHUB_WORKSPACE\}\/trusted-scripts"/);
  assert.equal(job.env.SCRIPT_DIR, '${{ github.workspace }}/trusted-scripts/.github/scripts/gemini-review');
  for (const [name, file] of Object.entries(SCRIPT_STEPS)) {
    assert.match(step(name).run, new RegExp(`^(node|bash) "\\$\\{SCRIPT_DIR\\}/${file.replace('.', '\\.')}"$`), name);
  }
  // The pull request checkout is data: nothing is run from the workspace root.
  assert.ok(!steps.some((candidate) => /(^|\s)(\.\/|node \.|bash \.)/.test(candidate.run ?? '')));
});

test('contract: the Gemini key and the GitHub token are never in the same step', () => {
  const holders = steps.filter((candidate) => JSON.stringify(candidate).includes('GEMINI_API_KEY'));
  assert.deepEqual(holders.map((candidate) => candidate.name), ['Review with Gemini']);
  assert.equal(text.match(/secrets\.GEMINI_API_KEY/g).length, 1);
  assert.ok(!JSON.stringify(stepEnv('Review with Gemini')).includes('GITHUB_TOKEN'));
  assert.ok(!Object.keys(stepEnv('Review with Gemini')).some((name) => /GH_TOKEN|GITHUB_TOKEN/.test(name)));
  for (const name of ['Decide whether to call Gemini', 'Report Gemini review', 'Collect PR diff and build prompt']) {
    assert.ok(!JSON.stringify(stepEnv(name)).includes('GEMINI_API_KEY'), name);
  }
});

test('contract: no untrusted value is interpolated into a script body', () => {
  for (const candidate of steps) assert.ok(!(candidate.run ?? '').includes('${{'), candidate.name);
});

describe('bugfix: Gemini failing to review must not fail the job or leave Diff Guardian without a status', () => {
  test('every step before the report is advisory and the report always runs last, so an outage cannot fail the job or leave no status', () => {
    for (const name of ['Collect PR diff and build prompt', 'Decide whether to call Gemini', 'Review with Gemini']) {
      assert.equal(step(name)['continue-on-error'], true, name);
    }
    const report = steps.at(-1);
    assert.equal(report.name, 'Report Gemini review');
    assert.match(report.if, /!cancelled\(\)/);
    assert.ok(!/success\(\)/.test(report.if));
    assert.equal(report['continue-on-error'], undefined);
  });

  test('the model call is skipped unless the decision says review, so bypass, unchanged and private runs cost nothing', () => {
    assert.match(step('Review with Gemini').if, /steps\.decide\.outputs\.action == 'review'/);
  });
});

test('contract: the report step receives everything post.mjs reads, and every script gets its env from the workflow', () => {
  const runnerProvided = new Set(['GITHUB_OUTPUT', 'GITHUB_STEP_SUMMARY', 'GITHUB_API_URL', 'RUNNER_TEMP']);
  for (const [name, file] of Object.entries(SCRIPT_STEPS).filter(([, script]) => script.endsWith('.mjs'))) {
    const source = readFileSync(`.github/scripts/gemini-review/${file}`, 'utf8');
    const read = [...new Set([...source.matchAll(/\benv\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1]))];
    const provided = new Set([...Object.keys(stepEnv(name)), ...Object.keys(job.env), ...runnerProvided]);
    const missing = read.filter((variable) => !provided.has(variable));
    // GEMINI_MODEL / DEFAULT fallbacks are optional by design.
    assert.deepEqual(missing.filter((variable) => variable !== 'GITHUB_API_URL'), [], `${file} reads variables the workflow does not set`);
  }
});

test('contract: the report step posts with the workflow token, so its review is authored by github-actions[bot], the author Diff Guardian reads', () => {
  assert.equal(stepEnv('Report Gemini review').GH_TOKEN, '${{ secrets.GITHUB_TOKEN }}');
  assert.ok(readFileSync('.github/scripts/diff-guardian/votes.sh', 'utf8').includes('github-actions[bot]'));
});

test('contract: the prompt travels as a file, never through step outputs or environment variables', () => {
  assert.ok(!text.includes('steps.diff.outputs.prompt }}') && !text.includes('GEMINI_PROMPT_EOF'));
  assert.equal(stepEnv('Review with Gemini').PROMPT_FILE, '${{ steps.diff.outputs.prompt_file }}');
});

test('bugfix: the temporary dry-run copy of this workflow is never merged (it would pay for every review twice)', () => {
  assert.equal(existsSync('.github/workflows/gemini-code-review-dryrun.yml'), false);
});

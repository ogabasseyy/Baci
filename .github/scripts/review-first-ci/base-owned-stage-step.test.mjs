// Runs the real `run:` text of the stage step (taken from ci.yml) against throwaway git
// repositories, to prove the gate cannot be edited by the pull request it judges:
// the base branch's copy of the scripts runs whenever the base has one.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import YAML from 'yaml';

const ci = YAML.parse(readFileSync(new URL('../../workflows/ci.yml', import.meta.url), 'utf8'));
const STEP = ci.jobs.changes.steps.find((step) => step.id === 'stage_review').run;
const ENTRY = '.github/scripts/review-first-ci/resolve-stage.mjs';

const stub = (label, { exitCode = 0, writeStage = true } = {}) =>
  `import { appendFileSync } from 'node:fs';\n${writeStage ? `appendFileSync(process.env.GITHUB_OUTPUT, 'stage=${label}\\ncode=stub\\n');\n` : ''}process.exit(${exitCode});\n`;

const git = (cwd, ...args) => {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

function scenario({ baseScript, prScript, baseSha }) {
  const repo = mkdtempSync(path.join(tmpdir(), 'stage-step-'));
  git(repo, 'init', '-q');
  writeFileSync(path.join(repo, 'README.md'), 'base\n');
  if (baseScript !== undefined) {
    mkdirSync(path.join(repo, path.dirname(ENTRY)), { recursive: true });
    writeFileSync(path.join(repo, ENTRY), baseScript);
  }
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  // the "pull request" commit rewrites the script in its own checkout
  mkdirSync(path.join(repo, path.dirname(ENTRY)), { recursive: true });
  writeFileSync(path.join(repo, ENTRY), prScript);
  writeFileSync(path.join(repo, '.github/scripts/review-first-ci/launch-stage.sh'), readFileSync(new URL('./launch-stage.sh', import.meta.url)));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'pull request');

  const output = path.join(repo, '..', `output-${path.basename(repo)}`);
  writeFileSync(output, '');
  const result = spawnSync('bash', ['-c', STEP], {
    cwd: repo,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, RUNNER_TEMP: mkdtempSync(path.join(tmpdir(), 'runner-temp-')), GITHUB_OUTPUT: output, BASE_SHA: baseSha ?? base },
  });
  const outputs = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((line) => line.split(/=(.*)/s).slice(0, 2)));
  return { result, outputs };
}

describe('the stage step runs the base branch copy of the gate scripts', () => {
  it('uses the base copy even though the pull request rewrote the script in its checkout', () => {
    const { result, outputs } = scenario({ baseScript: stub('base-copy'), prScript: stub('pr-copy-forces-full') });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.stage, 'base-copy');
  });

  it('only the pull request that introduces the scripts runs its own copy, with a warning', () => {
    const { result, outputs } = scenario({ baseScript: undefined, prScript: stub('pr-copy') });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(outputs.stage, 'pr-copy');
    assert.match(result.stdout, /the base branch has no review-first scripts yet/);
  });

  it('fails closed (quick) when the base commit is not in the checkout', () => {
    const { result, outputs } = scenario({ baseScript: stub('base-copy'), prScript: stub('pr-copy'), baseSha: '1'.repeat(40) });
    assert.equal(result.status, 0);
    assert.equal(outputs.stage, 'quick');
    assert.equal(outputs.code, 'resolver-failed');
    assert.match(result.stdout, /the base commit is not in this checkout/);
  });

  it('fails closed when the script crashes', () => {
    const { outputs } = scenario({ baseScript: stub('base-copy', { exitCode: 1 }), prScript: stub('pr-copy') });
    assert.equal(outputs.stage, 'quick');
    assert.equal(outputs.code, 'resolver-failed');
  });

  it('fails closed when the script exits cleanly without writing a stage', () => {
    const { outputs } = scenario({ baseScript: stub('base-copy', { writeStage: false }), prScript: stub('pr-copy') });
    assert.equal(outputs.stage, 'quick');
    assert.equal(outputs.code, 'resolver-failed');
  });
});

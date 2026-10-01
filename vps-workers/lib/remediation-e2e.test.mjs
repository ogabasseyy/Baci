import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runRemediationWorker } from './remediation-worker.test-harness.mjs';

function run(command, args, options = {}) {
  const { env, ...spawnOptions } = options;
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...spawnOptions,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      ...env,
    },
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed: ${result.stderr}`
  );
  return result.stdout.trim();
}

function writeExecutable(path, source) {
  writeFileSync(path, source, { mode: 0o700 });
}

function createFixtureRepository(directory) {
  const remoteDir = join(directory, 'remote.git');
  const repoDir = join(directory, 'checkout');
  run('git', ['init', '--bare', remoteDir]);
  run('git', ['init', '--initial-branch=main', repoDir]);
  run('git', ['config', 'user.email', 'fixture@example.test'], {
    cwd: repoDir,
  });
  run('git', ['config', 'user.name', 'Fixture'], { cwd: repoDir });
  writeFileSync(join(repoDir, 'README.md'), 'fixture base\n');
  run('git', ['add', 'README.md'], { cwd: repoDir });
  run('git', ['commit', '-m', 'fixture base'], { cwd: repoDir });
  run('git', ['remote', 'add', 'origin', remoteDir], { cwd: repoDir });
  run('git', ['push', '-u', 'origin', 'main'], { cwd: repoDir });
  return { remoteDir, repoDir };
}

function createFakeTools(directory) {
  const codex = join(directory, 'fake-codex.mjs');
  const gh = join(directory, 'fake-gh.mjs');
  const ghLog = join(directory, 'fake-gh.json');
  writeExecutable(
    codex,
    `#!/usr/bin/env node\nimport{writeFileSync}from'node:fs';const a=process.argv.slice(2),r=a.includes('--read-only')||a[a.indexOf('--sandbox')+1]==='read-only'||a.includes('--sandbox=read-only');if(r)console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'RESEARCH_SUMMARY: the fixture failure is isolated to the generated worktree.\\nROOT_CAUSE_CONFIDENCE: high\\nOPTIONS_CONSIDERED:\\n- apply the smallest fixture change\\n- make an operational-only change\\nSELECTED_FIX: apply the smallest fixture change\\nVALIDATION_PLAN: run the focused fixture verification command'}}));else writeFileSync('remediation-e2e-fix.txt','fixed by fixture\\n');console.log(JSON.stringify({type:'turn.completed'}));\n`
  );
  writeExecutable(
    gh,
    `#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs';\nconst args = process.argv.slice(2);\nappendFileSync(${JSON.stringify(ghLog)}, JSON.stringify(args) + '\\n');\nconsole.log(args[0] === 'pr' && args[1] === 'list' ? '[]' : 'https://example.test/baci/pull/77');\n`
  );
  return { codex, gh, ghLog };
}

function createPathSentinels(directory) {
  const sentinelDir = join(directory, 'sentinels');
  const codexHit = join(directory, 'sentinel-codex-hit');
  const ghHit = join(directory, 'sentinel-gh-hit');
  mkdirSync(sentinelDir);
  for (const [name, hitPath] of [
    ['codex', codexHit],
    ['gh', ghHit],
  ]) {
    writeExecutable(
      join(sentinelDir, name),
      `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(hitPath)}, 'unexpected literal ${name} call');\nprocess.exit(97);\n`
    );
  }
  writeExecutable(
    join(sentinelDir, 'pnpm'),
    `#!/usr/bin/env node\nimport{existsSync}from'node:fs';process.exit(existsSync('remediation-e2e-fix.txt')?0:98);\n`
  );
  return { codexHit, ghHit, sentinelDir };
}

function readFakeGhCalls(path) {
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const day = 24 * 60 * 60 * 1_000;

describe('remediation lifecycle end to end', () => {
  it('creates one isolated draft PR from a fixture and persists a safe pr_open case', async (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'baci-remediation-e2e-'));
    t.after(() => rmSync(directory, { force: true, recursive: true }));
    const { remoteDir, repoDir } = createFixtureRepository(directory);
    const { codex, gh, ghLog } = createFakeTools(directory);
    const { codexHit, ghHit, sentinelDir } = createPathSentinels(directory);
    const sentinelPath = `${sentinelDir}:${process.env.PATH || '/usr/bin:/bin'}`;
    const sentinelWorks = spawnSync('codex', [], {
      encoding: 'utf8',
      env: { ...process.env, PATH: sentinelPath },
    });
    assert.equal(sentinelWorks.status, 97);
    assert.equal(existsSync(codexHit), true);
    rmSync(codexHit);
    const outputDir = join(directory, 'output');
    let nowMs = Date.parse('2026-08-01T10:04:00.000Z');
    let observation = '2026-08-01T10:03:00.000Z';
    let occurrences = 3;
    const candidateLoader = async () => [
      {
        category: 'sentry_issue',
        fingerprint: 'fixture-77',
        firstSeen: '2026-08-01T10:00:00.000Z',
        lastSeen: observation,
        occurrences,
        sample: {
          issueId: 'issue-77',
          message: 'customer@example.test reported a fixture failure',
          source: 'sentry',
        },
        source: 'sentry',
      },
    ];
    const env = {
      BACI_REMEDIATION_AUTOFIX_ENABLED: '1',
      BACI_REMEDIATION_OUTPUT_DIR: outputDir,
      BACI_REMEDIATION_RUN_ID: 'fixture-e2e',
      BACI_REMEDIATION_VERIFY_COMMAND: 'test -f remediation-e2e-fix.txt',
      BACI_REMEDIATION_WORKTREE_ROOT: join(directory, 'worktrees'),
      BACI_REPO_DIR: repoDir,
      BACI_REMEDIATION_NOTIFY_EMAILS: '',
      CODEX_BIN: codex,
      GH_BIN: gh,
      GIT_AUTHOR_EMAIL: 'remediator@example.test',
      GIT_AUTHOR_NAME: 'Baci Remediator',
      GIT_COMMITTER_EMAIL: 'remediator@example.test',
      GIT_COMMITTER_NAME: 'Baci Remediator',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      PATH: sentinelPath,
      ZEPTOMAIL_TOKEN: '',
    };
    let fetchCalls = 0;
    const fetchFn = () => {
      fetchCalls += 1;
      throw new Error('network access is forbidden in the hermetic E2E');
    };

    const first = await runRemediationWorker({
      candidateLoader,
      env,
      fetchFn,
      logger: { error: () => undefined, log: () => undefined },
      now: () => nowMs,
      workerName: 'fixture-remediator',
    });

    const casePath = join(outputDir, 'case-state.autofix.json');
    const lifecycle = JSON.parse(readFileSync(casePath, 'utf8'));
    const stored = lifecycle.cases['sentry:sentry_issue:fixture-77'];
    const ghArgs = readFakeGhCalls(ghLog).find(
      (args) => args[0] === 'pr' && args[1] === 'create'
    );
    assert.ok(ghArgs);
    const body = ghArgs[ghArgs.indexOf('--body') + 1];
    assert.equal(
      first.actions.some((action) => action.type === 'pr_opened'),
      true
    );
    assert.equal(stored.status, 'pr_open');
    assert.equal(stored.draftPr.url, 'https://example.test/baci/pull/77');
    const branch = ghArgs[ghArgs.indexOf('--head') + 1];
    assert.match(
      branch,
      /^codex\/sentry-remediation-sentry-issue-fixture-77-[a-f0-9]{12}$/
    );
    const remoteCommit = run('git', [
      '--git-dir',
      remoteDir,
      'rev-parse',
      `refs/heads/${branch}`,
    ]);
    assert.match(remoteCommit, /^[0-9a-f]{40}$/);
    assert.equal(
      run('git', ['--git-dir', remoteDir, 'rev-parse', 'refs/heads/main']),
      run('git', ['rev-parse', 'HEAD'], { cwd: repoDir })
    );
    assert.equal(existsSync(join(repoDir, 'remediation-e2e-fix.txt')), false);
    assert.equal(run('git', ['status', '--porcelain'], { cwd: repoDir }), '');
    assert.equal(
      existsSync(join(directory, 'worktrees', 'fixture-77-fixture-e2e')),
      false
    );
    assert.match(body, /Case: sentry:sentry_issue:fixture-77/);
    assert.match(body, /Category: sentry_issue/);
    assert.match(body, /Lifecycle status: investigating/);
    assert.doesNotMatch(body, /customer@example\.test/);
    assert.match(first.report.text, /case=sentry:sentry_issue:fixture-77/);
    assert.match(first.report.text, /lifecycle=pr_open/);
    assert.doesNotMatch(first.report.text, /customer@example\.test/);
    assert.deepEqual(ghArgs.slice(0, 2), ['pr', 'create']);
    assert.equal(ghArgs.includes('merge'), false);

    observation = '2026-08-01T10:05:00.000Z';
    occurrences = 4;
    nowMs += 60_000;
    const firstRecurrence = await runRemediationWorker({
      candidateLoader,
      env,
      fetchFn,
      logger: { error: () => undefined, log: () => undefined },
      now: () => nowMs,
      workerName: 'fixture-remediator',
    });
    nowMs += 7 * day;
    await runRemediationWorker({
      candidateLoader: async () => [],
      env,
      fetchFn,
      logger: { error: () => undefined, log: () => undefined },
      now: () => nowMs,
      workerName: 'fixture-remediator',
    });
    observation = '2026-08-08T10:06:00.000Z';
    occurrences = 5;
    nowMs += 60_000;
    const recurrence = await runRemediationWorker({
      candidateLoader,
      env,
      fetchFn,
      logger: { error: () => undefined, log: () => undefined },
      now: () => nowMs,
      workerName: 'fixture-remediator',
    });

    const recurring = JSON.parse(readFileSync(casePath, 'utf8')).cases[
      'sentry:sentry_issue:fixture-77'
    ];
    assert.equal(
      recurrence.actions.some((action) => action.type === 'pr_opened'),
      false
    );
    assert.equal(
      firstRecurrence.actions.some(
        (action) => action.type === 'active_draft_recurrence'
      ),
      true
    );
    assert.match(firstRecurrence.report.text, /lifecycle=pr_open/);
    assert.match(firstRecurrence.report.text, /priorOutcomes=pr_opened/);
    assert.match(
      firstRecurrence.report.text,
      /draftPr=https:\/\/example\.test\/baci\/pull\/77/
    );
    assert.equal(
      recurrence.actions.some(
        (action) => action.type === 'active_draft_recurrence'
      ),
      true
    );
    assert.match(recurrence.report.text, /lifecycle=pr_open/);
    assert.match(recurrence.report.text, /priorOutcomes=pr_opened/);
    assert.equal(recurring.status, 'pr_open');
    assert.equal(recurring.recurrenceCount, 2);
    assert.equal(recurring.draftPr.url, 'https://example.test/baci/pull/77');
    assert.equal(recurring.outcomes.at(-1).type, 'pr_opened');
    assert.equal(
      readFakeGhCalls(ghLog).filter(
        (args) => args[0] === 'pr' && args[1] === 'create'
      ).length,
      1
    );
    assert.equal(fetchCalls, 0);
    assert.equal(existsSync(codexHit), false);
    assert.equal(existsSync(ghHit), false);
  });
});

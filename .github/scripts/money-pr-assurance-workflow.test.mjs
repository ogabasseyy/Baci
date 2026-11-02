// Contract tests binding the workflow, prompt, template, runbook and
// committed summaries to the assurance configuration. Text-based so the
// self-test job needs no dependency install.
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import test from 'node:test';
import {
  loadRawConfig,
  readRepoFile,
} from './money-pr-assurance.test-support.mjs';
import {
  globToRegExp,
  parseAssuranceConfig,
} from './money-pr-assurance-config.mjs';
import { validateSummary } from './money-pr-assurance-summary.mjs';

const config = parseAssuranceConfig(loadRawConfig());
const workflow = readRepoFile('.github/workflows/money-pr-assurance.yml');
const repoRoot = new URL('../../', import.meta.url).pathname;

function jobBlock(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.ok(start > 0, `job ${name} must exist`);
  const rest = workflow.slice(start + 1);
  const next = rest.slice(3).search(/\n {2}[a-z-]+:\n/);
  return next === -1 ? rest : rest.slice(0, next + 3);
}

test('the evaluator never checks out pull-request code and posts only statuses', () => {
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.doesNotMatch(workflow, /github\.event\.pull_request\.head\.ref/);
  assert.doesNotMatch(workflow, /refs\/pull\//);
  // The PR head SHA is only ever a status target, never a checkout ref.
  for (const line of workflow.match(/^.*pull_request\.head\.sha.*$/gm) ?? [])
    assert.match(line, /^ +HEAD_SHA: /);
  for (const line of workflow.match(/^ +ref: .*$/gm) ?? [])
    assert.equal(
      line.trim(),
      'ref: ${{ github.event.repository.default_branch }}'
    );
  const evaluate = jobBlock('evaluate');
  assert.match(
    evaluate,
    /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/
  );
  assert.match(evaluate, /persist-credentials: false/);
  assert.match(evaluate, /statuses: write/);
  assert.match(
    evaluate,
    /run: node \.github\/scripts\/money-pr-assurance\.mjs/
  );
  assert.match(workflow, /pull_request_target:/);
  assert.match(
    workflow,
    /github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/
  );
});

test('every write permission in the workflow is the status write', () => {
  const writes = workflow.match(/^\s+[a-z-]+: write$/gm) ?? [];
  assert.deepEqual(
    writes.map((line) => line.trim()),
    ['statuses: write']
  );
});

test('comment triggers listen to exactly the reviewer and owner logins', () => {
  const lists = [
    ...workflow.matchAll(
      /contains\(fromJSON\('(\[[^']+\])'\), github\.event\.comment\.user\.login\)/g
    ),
  ].map((match) => new Set(JSON.parse(match[1])));
  assert.equal(lists.length, 2, 'the job condition and its concurrency group');
  const expected = new Set(config.ownerSignoff.logins);
  for (const family of Object.values(config.reviewers.families)) {
    for (const login of [...family.logins, ...family.requestedBy])
      expected.add(login);
  }
  for (const list of lists) assert.deepEqual(list, expected);
});

test('only evaluating events share a concurrency group and none is cancelled', () => {
  const evaluate = jobBlock('evaluate');
  const condition = /\n {4}if: >-\n([\s\S]*?)\n {4}#/.exec(evaluate)[1];
  const group = /\$\{\{ \(([\s\S]*?)\) && \(github\.event/.exec(evaluate)[1];
  const squash = (text) => text.replace(/\s+/g, ' ').trim();
  assert.equal(squash(group), squash(condition));
  assert.match(
    evaluate,
    /format\('money-pr-assurance-run-\{0\}', github\.run_id\)/
  );
  assert.match(evaluate, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /^concurrency:/m, 'no workflow-level group');
});

test('workflow_run names and required check names exist in their workflows', () => {
  const runs = /workflows: \[([^\]]+)\]/
    .exec(workflow)[1]
    .split(',')
    .map((name) => name.trim());
  const names = readdirSync(join(repoRoot, '.github/workflows'))
    .filter((file) => file.endsWith('.yml'))
    .map((file) =>
      /^name: (.+)$/m
        .exec(readRepoFile(`.github/workflows/${file}`))?.[1]
        ?.trim()
    );
  for (const name of runs)
    assert.ok(names.includes(name), `workflow "${name}" must exist`);
  const ci = readRepoFile('.github/workflows/ci.yml');
  for (const { name } of config.requiredChecks) {
    assert.match(
      ci,
      new RegExp(`^ {4}name: ${name.replace(/[-]/g, '\\-')}$`, 'm'),
      `CI job "${name}" must exist`
    );
  }
});

test('the self-test runs whenever any governance file changes', () => {
  const selfTest = jobBlock('self-test');
  assert.match(
    selfTest,
    /run: node --test \.github\/scripts\/money-pr-assurance\*\.test\.mjs/
  );
  const pathsBlock = workflow.slice(
    workflow.indexOf('  pull_request:\n'),
    workflow.indexOf('\npermissions:')
  );
  const triggers = [...pathsBlock.matchAll(/- '([^']+)'/g)].map((match) =>
    globToRegExp(match[1])
  );
  const governed = [
    '.github/money-path-paths.json',
    '.github/prompts/money-rules-adversarial-review.md',
    '.github/workflows/money-pr-assurance.yml',
    '.github/workflows/money-pr-assurance-review-relay.yml',
    ...readdirSync(join(repoRoot, '.github/scripts'))
      .filter((file) => file.startsWith('money-pr-assurance'))
      .map((file) => `.github/scripts/${file}`),
  ];
  for (const path of governed) {
    assert.ok(
      config.governancePaths.some((glob) => globToRegExp(glob).test(path)),
      `${path} must be governed`
    );
    assert.ok(
      triggers.some((pattern) => pattern.test(path)),
      `${path} must trigger the self-test`
    );
  }
  // Other files the contract tests read: renaming a CI job or changing the
  // CI change filter must re-run them before it can strand money PRs.
  for (const path of [
    '.github/workflows/ci.yml',
    '.github/filters/ci.yml',
    'docs/runbooks/money-pr-assurance.md',
  ]) {
    assert.ok(
      triggers.some((pattern) => pattern.test(path)),
      `${path} must trigger the self-test`
    );
  }
});

test('the prompt names its version, the verdict block and every rule', () => {
  const prompt = readRepoFile(config.reviewers.promptPath);
  assert.ok(prompt.includes(config.reviewers.promptVersion));
  for (const key of [
    'MONEY-RULES-VERDICT:',
    'REVIEWED-HEAD:',
    'PROMPT-VERSION:',
  ])
    assert.ok(prompt.includes(key), key);
  // The verdict names the commit actually reviewed, not the live PR head.
  assert.ok(prompt.includes('git rev-parse HEAD'));
  assert.doesNotMatch(prompt, /headRefOid/);
  for (const rule of [
    'R1.',
    'R2.',
    'R3.',
    'R4.',
    'R5.',
    'Ledger decision',
    'Default 1.',
    'Default 8.',
    'Default 10.',
  ]) {
    assert.ok(prompt.includes(`**${rule}`), rule);
  }
});

test('the template uses the configured headings and defaults to owner sign-off', () => {
  const template = readRepoFile(`${config.summary.directory}/TEMPLATE.md`);
  const headings = [...template.matchAll(/^## (.+)$/gm)].map(
    (match) => match[1]
  );
  assert.deepEqual(headings, config.summary.headings);
  assert.match(template, /^Owner sign-off: required$/m);
});

test('every committed change summary passes the validator', () => {
  const directory = join(repoRoot, config.summary.directory);
  const files = readdirSync(directory).filter(
    (file) =>
      file.endsWith('.md') && !config.summary.ignoredFiles.includes(file)
  );
  assert.ok(files.length > 0);
  for (const file of files) {
    const result = validateSummary(
      readRepoFile(`${config.summary.directory}/${file}`),
      {
        taskId: file.slice(0, -3),
        ...config.summary,
      }
    );
    assert.deepEqual(result.errors, [], file);
  }
});

test('relative links and anchors in the assurance documents resolve', () => {
  const documents = [
    'docs/runbooks/money-pr-assurance.md',
    config.reviewers.promptPath,
    `${config.summary.directory}/TEMPLATE.md`,
  ];
  for (const document of documents) {
    const text = readRepoFile(document);
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue;
      const [path, anchor] = target.split('#');
      const resolved = path
        ? normalize(join(dirname(document), path))
        : document;
      assert.ok(
        existsSync(join(repoRoot, resolved)),
        `${document} links to missing ${target}`
      );
      if (anchor) {
        const slugs = [...readRepoFile(resolved).matchAll(/^#+ (.+)$/gm)].map(
          (match) =>
            match[1]
              .toLowerCase()
              .replace(/[^a-z0-9 -]/g, '')
              .replace(/ /g, '-')
        );
        assert.ok(
          slugs.includes(anchor),
          `${document} links to missing anchor #${anchor}`
        );
      }
    }
  }
});

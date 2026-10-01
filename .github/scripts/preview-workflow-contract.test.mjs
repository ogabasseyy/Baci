import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../workflows/preview.yml', import.meta.url),
  'utf8'
);

// Guard comments name the forbidden tokens; enforce against executable lines.
const executable = workflow
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

function jobBlock(name) {
  const block = executable.match(
    new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  \\w+:\\n|$)`)
  )?.[1];
  assert.ok(block, `${name} job must remain extractable`);
  return block;
}

test('preview workflow stays dispatch-only', () => {
  const onBlock = executable.match(/\non:\n([\s\S]*?)\n[a-z]+:/)?.[1];
  assert.ok(onBlock, 'on: block must remain extractable');
  const triggers = [...onBlock.matchAll(/^ {2}([a-z_]+):/gm)].map(
    (match) => match[1]
  );
  assert.deepEqual(triggers, ['workflow_dispatch']);
});

test('preview workflow selects the target ref via inputs, not --ref execution', () => {
  assert.match(workflow, /required:\s*true/);
  assert.match(workflow, /ref:\s*\$\{\{\s*inputs\.ref\s*\}\}/);
  assert.doesNotMatch(workflow, /^\s*repository:/m);
});

test('preview workflow refuses branch-selected workflow files', () => {
  const guard = executable.match(
    /Require default-branch workflow file[\s\S]*?(?=\n      - )/
  )?.[0];
  assert.ok(guard, 'guard step must remain extractable');
  assert.match(guard, /github\.ref/);
  assert.match(guard, /refs\/heads\//);
  assert.match(guard, /github\.event\.repository\.default_branch/);
  assert.match(guard, /exit 1/);
  const guardScript = guard.match(/run:\s*\|[\s\S]*/)?.[0] ?? '';
  assert.doesNotMatch(
    guardScript,
    /\$\{\{/,
    'guard must compare env vars, not interpolated expressions'
  );
});

test('preview workflow never promotes to production', () => {
  assert.doesNotMatch(executable, /--prod\b/);
  assert.doesNotMatch(executable, /environment:\s*production/);
  assert.doesNotMatch(executable, /name:\s*production/);
  assert.match(executable, /pull\s+--yes\s+--environment=preview/);
});

test('preview deploy stays prebuilt with the required archive flag', () => {
  assert.match(executable, /deploy\s+--yes\s+--prebuilt\s+--archive=tgz/);
});

test('preview workflow runs on github-hosted runners only', () => {
  assert.match(workflow, /runs-on:\s*ubuntu-24\.04/);
  assert.doesNotMatch(workflow, /self-hosted/);
  assert.doesNotMatch(workflow, /baci-deploy/);
  assert.doesNotMatch(workflow, /baci-vps/);
});

test('untrusted build runs isolated between trusted token jobs', () => {
  assert.match(jobBlock('build'), /needs:\s*\[prepare\]/);
  assert.match(jobBlock('deploy'), /needs:\s*\[build\]/);
  const checkouts =
    executable.match(/uses:\s*actions\/checkout@/g) ?? [];
  assert.equal(checkouts.length, 4);
  const build = jobBlock('build');
  assert.ok(
    build.indexOf('Checkout preview source') <
      build.indexOf('Checkout trusted ops files'),
    'source checkout must precede the trusted checkout it could wipe'
  );
});

test('token jobs are tagged with the preview environment', () => {
  const tagged = executable.match(/^\s*environment:\s*preview$/gm) ?? [];
  assert.equal(tagged.length, 2);
  assert.doesNotMatch(jobBlock('build'), /environment:\s*preview/);
});

test('preview helpers execute from trusted checkouts only', () => {
  const prepare = jobBlock('prepare');
  const build = jobBlock('build');
  const deploy = jobBlock('deploy');
  // Prepare's root is a full default-branch checkout, so root-relative
  // helpers are trusted there.
  assert.match(prepare, /run:\s*\.github\/scripts\/run-pinned-vercel\.sh/);
  assert.doesNotMatch(prepare, /trusted-ops\//);
  // Build and deploy roots are untrusted or empty: only trusted-ops helpers.
  for (const [name, block] of [
    ['build', build],
    ['deploy', deploy],
  ]) {
    assert.match(block, /path:\s*trusted-ops/, `${name} isolates helpers`);
    assert.doesNotMatch(block, /run:\s*\.github\/scripts\//);
    assert.doesNotMatch(block, /run:\s*node\s+\.github\/scripts\//);
    assert.doesNotMatch(block, /uses:\s*\.\/\.github\/actions\//);
  }
  assert.match(
    build,
    /uses:\s*\.\/trusted-ops\/\.github\/actions\/pnpm-install-cached/
  );
  assert.match(
    build,
    /\.\/trusted-ops\/\.github\/scripts\/pnpm-install-with-retry\.sh/
  );
  const trustedRuns = executable.match(
    /trusted-ops\/\.github\/scripts\/run-pinned-vercel\.sh/g
  );
  assert.ok(
    trustedRuns && trustedRuns.length === 3,
    'build, pull, and deploy must invoke the trusted runner'
  );
});

test('deployment secrets stay off job-level environments', () => {
  const jobEnvs = [
    ...executable.matchAll(/\n {4}env:\n((?: {6}[^\n]*\n)+)/g),
  ].map((match) => match[1]);
  assert.ok(jobEnvs.length >= 3, 'all job env blocks must be extractable');
  for (const jobEnv of jobEnvs) {
    for (const secret of [
      'TURBO_TOKEN',
      'TURBO_TEAM',
      'VERCEL_ORG_ID',
      'VERCEL_PROJECT_ID',
      'VERCEL_TOKEN',
      'QUIZ_RPC_SERVER_SECRET',
    ]) {
      assert.doesNotMatch(
        jobEnv,
        new RegExp(`^ {6}${secret}:`, 'm'),
        `${secret} must be step-scoped, not job-scoped`
      );
    }
  }
});

test('deployment token reaches only the trusted pull and deploy steps', () => {
  const count = (name) =>
    executable.match(new RegExp(`^\\s*${name}:`, 'gm'))?.length ?? 0;
  assert.equal(count('VERCEL_TOKEN'), 3);
  assert.equal(count('VERCEL_ORG_ID'), 3);
  assert.equal(count('VERCEL_PROJECT_ID'), 3);
  assert.equal(count('TURBO_TOKEN'), 1);
  assert.equal(count('TURBO_TEAM'), 1);
  assert.doesNotMatch(jobBlock('build'), /VERCEL_TOKEN/);
  assert.doesNotMatch(jobBlock('build'), /VERCEL_ORG_ID/);
  assert.doesNotMatch(jobBlock('build'), /VERCEL_PROJECT_ID/);
});

test('preview verifies sensitive markings before injecting stand-ins', () => {
  const prepare = jobBlock('prepare');
  assert.match(
    prepare,
    /assert-vercel-pulled-sensitive-env\.mjs\s+QUIZ_RPC_SERVER_SECRET\s+\.vercel\/\.env\.preview\.local/
  );
  assert.ok(
    prepare.indexOf('Normalize sensitive placeholders') <
      prepare.indexOf('inject-prebuilt-env-secret.mjs QUIZ_RPC_SERVER_SECRET'),
    'placeholder normalization must precede stand-in injection'
  );
  assert.match(prepare, /SUPABASE_AGENTIC_JWT_PRIVATE_JWK=""/);
});

test('preview build uses stand-ins, never real server secrets', () => {
  assert.doesNotMatch(executable, /QUIZ_RPC_SERVER_SECRET:\s*\$\{\{/);
  assert.match(executable, /build-time-presence-stand-in/);
  assert.match(executable, /--generate-es256-jwk-standin/);
  assert.doesNotMatch(
    executable,
    /SUPABASE_AGENTIC_JWT_PRIVATE_JWK:\s*\$\{\{/
  );
});

test('only the known deployment secrets are bound', () => {
  const bound = new Set(
    [...executable.matchAll(/secrets\.([A-Z_]+)/g)].map(
      (match) => match[1]
    )
  );
  assert.deepEqual(
    [...bound].sort(),
    [
      'TURBO_TEAM',
      'TURBO_TOKEN',
      'VERCEL_ORG_ID',
      'VERCEL_PROJECT_ID',
      'VERCEL_TOKEN',
    ].sort()
  );
});

test('free-form ref never reaches a shell script', () => {
  const lines = executable.split('\n');
  let inRunBlock = false;
  for (const line of lines) {
    if (/^\s*run:\s*\|/.test(line)) {
      inRunBlock = true;
      continue;
    }
    if (/^\s*run:\s*\S/.test(line)) {
      assert.doesNotMatch(line, /inputs\.ref/);
      assert.doesNotMatch(line, /github\.ref/);
      inRunBlock = false;
      continue;
    }
    if (inRunBlock) {
      if (/^\s{10,}\S/.test(line)) {
        assert.doesNotMatch(line, /inputs\.ref/);
        assert.doesNotMatch(line, /github\.ref/);
        continue;
      }
      inRunBlock = false;
    }
  }
  for (const line of lines.filter((candidate) =>
    candidate.includes('inputs.ref')
  )) {
    assert.match(
      line,
      /^\s*(group|ref|PREVIEW_REF):/,
      'inputs.ref is allowed only in concurrency, checkout, and env positions'
    );
  }
});

test('artifacts expire at minimum retention', () => {
  const retentions =
    executable.match(/retention-days:\s*1\b/g) ?? [];
  assert.equal(retentions.length, 2);
});

test('preview URL parsing anchors on the deploy assignment line', () => {
  const deploy = jobBlock('deploy');
  assert.match(deploy, /grep -oiE 'preview:/);
  assert.match(deploy, /https:\/\/\[\^ \]\+\\.vercel\\.app/);
  // Last match wins (Vercel prints the assignment after upload echoes;
  // same convention as deploy-with-retry.sh). Never first-match.
  assert.match(deploy, /\|\s*tail -n 1/);
  assert.doesNotMatch(deploy, /head -n 1/);
  // No-match grep must not exit the step under pipefail before the
  // status-aware handling runs.
  assert.match(deploy, /tail -n 1 \|\| true/);
  assert.match(deploy, /exit 1/);
});

test('deploy step fails fast with the true CLI exit code', () => {
  const deploy = jobBlock('deploy');
  assert.match(deploy, /set -euo pipefail/);
});

test('deploy step survives CLI hangs and captures diagnostics', () => {
  const deploy = jobBlock('deploy');
  assert.match(deploy, /2>&1 \| tee preview-deploy\.log/);
  assert.match(deploy, /timeout[^\n]*run-pinned-vercel\.sh deploy/);
  assert.match(deploy, /PIPESTATUS\[0\]/);
  assert.match(deploy, /deploy_status.*124/);
});

test('deploy job bootstraps pnpm before helpers', () => {
  const deploy = jobBlock('deploy');
  assert.match(
    deploy,
    /pnpm\/action-setup@0ebf47130e4866e96fce0953f49152a61190b271/
  );
  assert.ok(
    deploy.indexOf('pnpm/action-setup') <
      deploy.indexOf('pull --yes --environment=preview'),
    'pnpm setup must precede the first CLI invocation'
  );
});

test('handoff artifacts survive reruns', () => {
  const overwrites = executable.match(/overwrite:\s*true/g) ?? [];
  assert.equal(overwrites.length, 2);
});

test('deploy summary neutralizes markdown in the branch name', () => {
  const deploy = jobBlock('deploy');
  assert.match(deploy, /safe_ref=.*tr -d '\\n\\r`'/);
  assert.match(deploy, /Preview ready for \\`\$safe_ref\\`/);
  assert.doesNotMatch(deploy, /\$PREVIEW_REF:\s*\$preview_url/);
});

test('trusted checkouts pin the running commit, never the branch name', () => {
  const refs = [...executable.matchAll(/^\s*ref:\s*\$\{\{\s*([a-z._]+)\s*\}\}/gm)].map(
    (match) => match[1]
  );
  assert.deepEqual(refs.sort(), [
    'github.sha',
    'github.sha',
    'github.sha',
    'inputs.ref',
  ]);
});

test('untrusted build reads but never writes the remote cache', () => {
  const build = jobBlock('build');
  assert.match(build, /TURBO_CACHE:\s*"remote:r,local:rw"/);
});

test('no checkout persists credentials or takes credential inputs', () => {
  const checkoutSteps = executable
    .split('\n      - ')
    .filter((step) => step.includes('actions/checkout@'));
  assert.equal(checkoutSteps.length, 4);
  for (const step of checkoutSteps) {
    assert.match(step, /persist-credentials:\s*false/);
    assert.doesNotMatch(step, /^\s*token:/m);
    assert.doesNotMatch(step, /^\s*ssh-key:/m);
  }
});

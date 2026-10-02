import assert from 'node:assert/strict';
import test from 'node:test';
import { previewWorkflowContract } from './preview-workflow-contract.helpers.mjs';

const { executable, jobBlock, previewEnvAllowlist, previewEnvRedact, workflow } =
  previewWorkflowContract;

const DENIED_KEYS = [
  'ADDRESS_AUTOCOMPLETE_KV_REST_API_READ_ONLY_TOKEN',
  'ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN',
  'ADDRESS_AUTOCOMPLETE_KV_URL',
  'ADDRESS_AUTOCOMPLETE_REDIS_URL',
  'AUTONOMA_SECRET_ID',
  'BLOG_PREVIEW_SECRET',
  'CRON_SECRET',
  'EDGE_CONFIG',
  'GEMINI_API_KEY',
  'GO54_API_KEY',
  'GOOGLE_GENAI_API_KEY',
  'IMPORT_JOB_WORKER_SECRET',
  'INTERNAL_API_SECRET',
  'KV_REST_API_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VERCEL_OIDC_TOKEN',
  'ZEPTOMAIL_MAILAGENT_KEY',
  'ZEPTOMAIL_TOKEN',
  'ZOHO_CLIENT_SECRET',
  'ZOHO_REFRESH_TOKEN',
];

// Cache-mode ownership keys are deleted (not blanked) so the build job's
// explicit TURBO_CACHE owns the mode with no precedence gamble and no
// reliance on empty-string-means-unset handling.
const DENIED_ABSENT_KEYS = ['TURBO_CACHE', 'TURBO_REMOTE_ONLY'];

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

test('preview mints the JWK stand-in only after the blank precondition', () => {
  const prepare = jobBlock('prepare');
  assert.ok(
    prepare.indexOf('Ensure JWK stand-in precondition') <
      prepare.indexOf('--generate-es256-jwk-standin'),
    'the blank precondition must precede JWK generation (Preview has no legacy fallback to verify)'
  );
});

test('preview build uses stand-ins, never real server secrets', () => {
  assert.doesNotMatch(executable, /QUIZ_RPC_SERVER_SECRET:\s*\$\{\{/);
  assert.match(executable, /build-time-presence-stand-in/);
  assert.match(executable, /--generate-es256-jwk-standin/);
  assert.doesNotMatch(
    executable,
    /SUPABASE_AGENTIC_JWT_PRIVATE_JWK:\s*\$\{\{/
  );
  assert.doesNotMatch(executable, /SUPABASE_SERVICE_ROLE_KEY:\s*\$\{\{/);
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

test('preview fails closed on unexpected exposed server values', () => {
  const prepare = jobBlock('prepare');
  assert.match(
    prepare,
    /assert-preview-env-allowlist\.mjs \.vercel\/\.env\.preview\.local \.github\/scripts\/preview-env-allowlist\.txt/
  );
  assert.ok(
    prepare.indexOf('assert-preview-env-allowlist') <
      prepare.indexOf('inject-prebuilt-env-secret.mjs QUIZ'),
    'exposure check must run pre-injection on the pulled state'
  );
  assert.ok(
    prepare.indexOf('assert-preview-env-allowlist') <
      prepare.indexOf('preview-vercel-dir'),
    'exposure check must precede the env artifact upload'
  );
});

test('preview redacts privileged values before the exposure check', () => {
  const prepare = jobBlock('prepare');
  assert.match(
    prepare,
    /sed -i -E -f \.github\/scripts\/preview-env-redact\.sed \.vercel\/\.env\.preview\.local/
  );
  assert.ok(
    prepare.indexOf('preview-env-redact.sed') <
      prepare.indexOf('assert-preview-env-allowlist'),
    'redaction must precede the exposure check'
  );
  assert.match(
    previewEnvRedact,
    /s\/\^export\[\[:blank:\]\]/,
    'redact patterns must accept the export-prefixed form the gate allows'
  );
  for (const key of DENIED_KEYS) {
    assert.match(
      previewEnvRedact,
      new RegExp(`s/\\^${key}=\\.\\*/${key}=""\\/`),
      `${key} must stay redacted`
    );
    assert.doesNotMatch(
      previewEnvAllowlist,
      new RegExp(`^${key}$`, 'm'),
      `${key} must not be allowlisted`
    );
  }
  for (const key of DENIED_ABSENT_KEYS) {
    assert.match(
      previewEnvRedact,
      new RegExp(
        `/\\^\\(export\\[\\[:blank:\\]\\]\\+\\)\\?${key}=\\.\\*/d`
      ),
      `${key} must be deleted (export-prefix-tolerant) so the job owns it`
    );
    assert.doesNotMatch(
      previewEnvAllowlist,
      new RegExp(`^${key}$`, 'm'),
      `${key} must not be allowlisted`
    );
  }
});

test('preview stands in the redacted service-role key', () => {
  const prepare = jobBlock('prepare');
  assert.match(
    prepare,
    /inject-prebuilt-env-secret\.mjs SUPABASE_SERVICE_ROLE_KEY \.vercel\/\.env\.preview\.local 'build-time-presence-stand-in-not-a-real-service-key-000000'/
  );
  assert.ok(
    prepare.indexOf('preview-env-redact.sed') <
      prepare.indexOf('inject-prebuilt-env-secret.mjs SUPABASE_SERVICE_ROLE_KEY'),
    'service-role must be blanked before the stand-in replaces it'
  );
  assert.ok(
    prepare.indexOf('inject-prebuilt-env-secret.mjs SUPABASE_SERVICE_ROLE_KEY') <
      prepare.indexOf('preview-vercel-dir'),
    'service-role stand-in must precede the env artifact upload'
  );
});

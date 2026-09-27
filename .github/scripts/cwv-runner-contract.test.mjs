import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';

import YAML from 'yaml';

import { assertWorkflowContract } from './cwv-runner-authority-runtime.mjs';
import { createGithubAppTokenPostReceipt } from './cwv-runner-create-github-app-token-post.receipt.mjs';

const root = new URL('../..', import.meta.url);
const pins = { checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', uploadArtifact: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', downloadArtifact: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', createGithubAppToken: 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1' };
const auditorTokenExpression = '${{ steps.auditor-token.outputs.token }}';
const read = () => readFile(new URL('.github/workflows/cwv-runner-attestation.yml', root), 'utf8');
const workflowSourceNames = (names) => names.filter((name) => /\.ya?ml$/i.test(name));
const expressionPaths = (value, expression, path = '') => {
  if (value === expression) return [path];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => expressionPaths(nested, expression, path ? `${path}.${key}` : key));
};
const filterPaths = (source, name) => {
  const match = source.match(new RegExp(`^${name}:\\n(?<paths>(?:  - .+\\n?)+)`, 'm'));

  return match?.groups?.paths ?? '';
};
const readRepositorySources = async () => {
  const workflows = Object.fromEntries(await Promise.all(workflowSourceNames(await readdir(new URL('.github/workflows/', root))).map(async (name) => [name, await readFile(new URL(`.github/workflows/${name}`, root), 'utf8')])));
  return {
    actionlint: await readFile(new URL('.github/actionlint.yaml', root), 'utf8'),
    actionlintWorkflow: workflows['actionlint.yml'],
    authoritySources: {
      authority: await readFile(new URL('.github/scripts/cwv-runner-authority.mjs', root), 'utf8'),
      canonical: await readFile(new URL('.github/scripts/canonical-json.mjs', root), 'utf8'),
      core: await readFile(new URL('.github/scripts/cwv-runner-authority-core.mjs', root), 'utf8'),
      filters: await readFile(new URL('.github/scripts/cwv-runner-authority-filters.mjs', root), 'utf8'),
      policy: await readFile(new URL('.github/scripts/policy.schema.mjs', root), 'utf8'),
      runtime: await readFile(new URL('.github/scripts/cwv-runner-authority-runtime.mjs', root), 'utf8'),
      stable: await readFile(new URL('.github/scripts/cwv-runner-stable-attestation-builder.mjs', root), 'utf8'),
    },
    ciFilter: await readFile(new URL('.github/filters/ci.yml', root), 'utf8'),
    deploy: workflows['deploy.yml'],
    deployFilter: await readFile(new URL('.github/filters/deploy.yml', root), 'utf8'),
    workflows,
  };
};

test('YAML workflow contract parser declares its direct runtime dependency', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const lockfile = YAML.parse(await readFile(new URL('pnpm-lock.yaml', root), 'utf8'));
  const workspace = YAML.parse(
    await readFile(new URL('pnpm-workspace.yaml', root), 'utf8')
  );
  assert.equal(manifest.devDependencies.yaml, '^2.9.0');
  assert.equal(
    lockfile.importers['.'].devDependencies.yaml.specifier,
    workspace.overrides.yaml
  );
});

test('CI and deploy gate every direct CWV dependency and aggregate its contract result', async () => {
  const { ciFilter, deployFilter, workflows } = await readRepositorySources();
  const ci = YAML.parse(workflows['ci.yml']);
  const deploy = YAML.parse(workflows['deploy.yml']);
  const requiredPaths = [
    'infra/cwv-runner/**',
    '.github/workflows/**',
    '.github/scripts/canonical-json.mjs',
    '.github/scripts/policy.json',
    '.github/scripts/policy.schema.mjs',
    '.github/scripts/actionlint-runner-label-contract.test.mjs',
    'biome.json',
    'pnpm-workspace.yaml',
  ];

  assert.equal(
    deploy.jobs.changes.steps.find((step) => step.id === 'filter').with.filters,
    '.github/filters/deploy.yml',
  );
  assert.equal(
    ci.jobs.changes.steps.find((step) => step.id === 'filter').with.filters,
    '.github/filters/ci.yml',
  );
  for (const source of [ciFilter, deployFilter]) {
    const paths = filterPaths(source, 'cwv_runner');
    for (const path of requiredPaths) assert.ok(paths.includes(`'${path}'`), `${path} must trigger the CWV contract gate`);
  }
  for (const workflow of [ci, deploy]) {
    assert.match(
      workflow.jobs['cwv-runner-contracts'].steps.find((step) => step.name === 'Run CWV runner contract tests').run,
      /\.github\/scripts\/actionlint-runner-label-contract\.test\.mjs/,
    );
  }

  const quality = ci.jobs.quality;
  assert.ok(quality.needs.includes('cwv-runner-contracts'));
  assert.equal(
    quality.steps[0].env.CWV_RUNNER_CONTRACTS_RESULT,
    "${{ needs['cwv-runner-contracts'].result }}",
  );
  assert.match(quality.steps[0].run, /"\$CWV_RUNNER_CONTRACTS_RESULT"/);
  assert.doesNotMatch(
    deploy.jobs['deploy-production'].if,
    /cwv_runner/,
    'runner-only main pushes must not deploy production',
  );
  assert.match(
    deploy.jobs['deploy-production'].if,
    /github\.event_name == 'workflow_dispatch' \|\| needs\.changes\.outputs\.web == 'true'/,
    'production deployment must remain available for manual dispatch or web changes',
  );
});

test('workflow discovery includes portable YAML file names and extensions', () => {
  assert.deepEqual(workflowSourceNames(['attest.yml', 'deploy.yaml', 'CI_WORKFLOW.YAML', 'release.candidate.yml', '.hidden.yml', 'release candidate (v2)!.yaml', 'café 日本語.yml', 'notes.yaml.bak', 'readme.md']), ['attest.yml', 'deploy.yaml', 'CI_WORKFLOW.YAML', 'release.candidate.yml', '.hidden.yml', 'release candidate (v2)!.yaml', 'café 日本語.yml']);
});

test('attestation workflow parses to the exact offline, manual, least-privileged step graph', async () => {
  const source = await read(); const workflow = YAML.parse(source, { merge: false, strict: true });
  assert.equal(workflow.name, 'CWV Runner Attestation'); assert.deepEqual(Object.keys(workflow.permissions), ['actions', 'contents']); assert.deepEqual(workflow.permissions, { actions: 'read', contents: 'read' });
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']); assert.deepEqual(workflow.jobs.attest['runs-on'], ['self-hosted', 'baci-cwv-measurement']); assert.equal(workflow.jobs.attest['timeout-minutes'], 20);
  const steps = workflow.jobs.attest.steps; assert.equal(steps.length, 10); assert.deepEqual(steps.filter((step) => step.uses).map((step) => step.uses).sort(), Object.values(pins).sort());
  const scratch = steps.find((step) => step.name === 'Create private authority scratch'); const checkout = steps.find((step) => step.uses === pins.checkout);
  assert.deepEqual(scratch.env, {
    BACI_CWV_ADMISSION_ID: '${{ inputs.admission_id }}',
    BACI_CWV_HOST_EVIDENCE_DIR: '/host-evidence',
  });
  assert.doesNotMatch(
    source,
    /BACI_CWV_LOCAL_ATTESTATION_PATH|\/opt\/baci-cwv\/runner-attestation\.json/,
    'the workflow must construct the public projection after authority checks rather than consume an unproduced pre-run artifact'
  );
  assert.equal(steps.indexOf(checkout), steps.indexOf(scratch) + 1); assert.deepEqual(checkout.with, { ref: '${{ github.sha }}', 'persist-credentials': false }); assert.equal(steps.at(-1).if, '${{ always() }}'); assert.match(steps.at(-1).run, /--cleanup$/);
  assert.equal(steps.find((step) => step.id === 'upload-attestation').with['retention-days'], 90); assert.equal(steps.find((step) => step.name === 'Download verified projected attestation').with['artifact-ids'], '${{ steps.upload-attestation.outputs.artifact-id }}');
  const uploadVerification = steps.find((step) => step.name === 'Verify uploaded artifact metadata');
  assert.equal(uploadVerification.env.BACI_CWV_ARTIFACT_DIGEST, '${{ steps.upload-attestation.outputs.artifact-digest }}', 'the pinned upload-artifact action emits its raw SHA-256 output; the sealed runtime owns REST digest prefix normalization');
  assert.equal(
    Object.hasOwn(steps.find((step) => step.id === 'auditor-token').with, 'skip-token-revoke'),
    false,
    'the pinned action post hook must retain token state as a cancellation fallback after early verified revocation'
  );
  assert.equal(steps.at(-1).name, 'Clean private state after platform token revocation registration');
  await assertWorkflowContract(source, { workflowActions: pins });
});

test('requires early verified revocation plus the pinned action post fallback', async () => {
  const isolated = await mkdtemp(join(tmpdir(), 'cwv-authority-missing-runtime-'));
  try {
    const entrypoint = join(isolated, 'cwv-runner-authority.mjs'); await writeFile(entrypoint, await readFile(new URL('.github/scripts/cwv-runner-authority.mjs', root), 'utf8'));
    const failure = spawnSync(process.execPath, [entrypoint, '--verify-and-project'], { env: { RUNNER_TEMP: '/tmp' } });
    assert.equal(failure.status, 1); assert.match(failure.stderr.toString(), /ERR_MODULE_NOT_FOUND|Cannot find module/);
  } finally { await rm(isolated, { force: true, recursive: true }); }
  const source = await read(); const workflow = YAML.parse(source, { merge: false, strict: true }); const steps = workflow.jobs.attest.steps;
  const appToken = steps.find((step) => step.id === 'auditor-token'); const authority = steps.find((step) => step.name === 'Verify authority and write projection');
  assert.equal(
    Object.hasOwn(appToken.with, 'skip-token-revoke'),
    false,
    'the workflow must keep the pinned action post revoker enabled'
  );
  assert.ok(steps.indexOf(appToken) < steps.indexOf(authority));
  assert.equal(authority.env.BACI_CWV_AUDITOR_TOKEN, auditorTokenExpression);
  assert.doesNotMatch(authority.run, /auditor-token\.outputs\.token|BACI_CWV_AUDITOR_TOKEN/);
  const tokenConsumers = steps.flatMap((step) => expressionPaths(step, auditorTokenExpression).map((path) => `${step.name}:${path}`));
  assert.deepEqual(tokenConsumers, ['Verify authority and write projection:env.BACI_CWV_AUDITOR_TOKEN'], 'the raw token output may appear only in the approved authority environment, never in a shell, action input, output, artifact, condition, or cleanup step');
});

test('sealed pinned App-token post receipt warns without failing after early revocation returns 401', async () => {
  const workflow = YAML.parse(await read(), { merge: false, strict: true });
  const tokenStep = workflow.jobs.attest.steps.find((step) => step.id === 'auditor-token');
  assert.equal(tokenStep.uses, createGithubAppTokenPostReceipt.action);
  assert.equal(createGithubAppTokenPostReceipt.action, pins.createGithubAppToken);
  assert.deepEqual(
    {
      actionYamlSha256: createGithubAppTokenPostReceipt.actionYamlSha256,
      bundlePath: createGithubAppTokenPostReceipt.bundlePath,
      bundleSha256: createGithubAppTokenPostReceipt.bundleSha256,
      sourceRange: createGithubAppTokenPostReceipt.sourceRange,
      sourceSha256: createGithubAppTokenPostReceipt.sourceSha256,
    },
    {
      actionYamlSha256: '2c4c77d1cafa8d792ab4a9d449799221baf95176a47692ad9a0b350b0a2618ed',
      bundlePath: 'dist/post.cjs',
      bundleSha256: 'c127db2f86238e3b57a5a57120a1de5f1b873006ee5b60c56b871de83dd7dfe2',
      sourceRange: { firstLine: 20984, lastLine: 21016 },
      sourceSha256: 'b734f35f5483b4d771a0e3ee2e88136df25bb1b6f9068c203ed3086564aa3712',
    }
  );
  assert.equal(
    createHash('sha256').update(createGithubAppTokenPostReceipt.source).digest('hex'),
    createGithubAppTokenPostReceipt.sourceSha256,
    'sealed immutable post-source receipt drifted'
  );
  const post = Function(`${createGithubAppTokenPostReceipt.source}\nreturn post;`)();
  const warnings = [];
  let requests = 0;
  await post(
    {
      getBooleanInput: () => false,
      getState: (name) => (name === 'token' ? 'already-revoked-test-token' : ''),
      info: () => undefined,
      warning: (message) => warnings.push(message),
    },
    async (route, options) => {
      requests += 1;
      assert.equal(route, 'DELETE /installation/token');
      assert.equal(options.headers.authorization, 'token already-revoked-test-token');
      const error = new Error('401 Unauthorized');
      error.status = 401;
      throw error;
    }
  );
  assert.equal(requests, 1);
  assert.deepEqual(warnings, ['Token revocation failed: 401 Unauthorized']);
});

test('structural YAML checks reject a new trigger, unpinned step, or cleanup bypass', async () => {
  const source = await read();
  await assert.rejects(assertWorkflowContract(source.replace('workflow_dispatch:', 'pull_request:'), { workflowActions: pins }), /schema/);
  await assert.rejects(assertWorkflowContract(source.replace(pins.uploadArtifact, 'actions/upload-artifact@main'), { workflowActions: pins }), /step graph/);
  await assert.rejects(assertWorkflowContract(source.replace('if: ${{ always() }}', 'if: success()'), { workflowActions: pins }), /step graph/);
});

test('contract rejects a changed first gate, App scope, or artifact handoff', async () => {
  const source = await read();
  await assert.rejects(assertWorkflowContract(source.replace('Validate sealed runner admission', 'Checkout before gate'), { workflowActions: pins }), /(step graph|job)/);
  await assert.rejects(assertWorkflowContract(source.replace('owner: ogabasseyy', 'owner: another-owner'), { workflowActions: pins }), /step graph/);
  const runtimeRevokerBypassed = source.replace(
    '          github-api-url: https://api.github.com',
    '          skip-token-revoke: "true"\n          github-api-url: https://api.github.com'
  );
  await assert.rejects(assertWorkflowContract(runtimeRevokerBypassed, { workflowActions: pins }), /step graph/);
  await assert.rejects(assertWorkflowContract(source.replace('artifact-ids: ${{ steps.upload-attestation.outputs.artifact-id }}', 'artifact-ids: 9'), { workflowActions: pins }), /step graph/);
});

test('sealed workflow grammar rejects injected triggers, permissions, jobs, selectors, and unknown keys', async () => {
  const source = await read();
  const mutations = [
    source.replace('  workflow_dispatch:', '  workflow_dispatch:\n  pull_request:'),
    source.replace('contents: read', 'contents: write'),
    source.replace('  attest:', '  attacker:\n    runs-on: ubuntu-latest\n    steps: []\n  attest:'),
    source.replace('runs-on: [self-hosted, baci-cwv-measurement]', 'runs-on: ubuntu-latest'),
    source.replace('name: CWV Runner Attestation', 'name: CWV Runner Attestation\nunknown: true'),
  ];
  for (const mutation of mutations)
    await assert.rejects(assertWorkflowContract(mutation, { workflowActions: pins }), /workflow (?:schema|job|step graph)/);
});

test('workflow source has no browser or storefront role after YAML parsing', async () => {
  const workflow = YAML.parse(await read(), { merge: false, strict: true }); const encoded = JSON.stringify(workflow);
  assert.doesNotMatch(encoded, /storefront|lighthouse|debugbear|pagespeed|browser/i);
});

test('repository closure rejects a missing actionlint label, block-list selector in a hidden workflow, or deploy-filter drift', async () => {
  const source = await read(); const repositorySources = await readRepositorySources();
  await assertWorkflowContract(source, { workflowActions: pins, repositorySources });
  await assert.rejects(assertWorkflowContract(source, { workflowActions: pins, repositorySources: { ...repositorySources, actionlint: repositorySources.actionlint.replace('    - baci-cwv-measurement\n', '') } }), /actionlint/);
  for (const name of ['.hidden.yml', 'release candidate (v2)!.yaml', 'café 日本語.yml'])
    await assert.rejects(assertWorkflowContract(source, { workflowActions: pins, repositorySources: { ...repositorySources, workflows: { ...repositorySources.workflows, [name]: 'jobs:\n  other:\n    runs-on:\n      - self-hosted\n      - baci-cwv-measurement' } } }), /selector/);
  await assert.rejects(assertWorkflowContract(source, { workflowActions: pins, repositorySources: { ...repositorySources, deploy: repositorySources.deploy.replace('filters: .github/filters/deploy.yml', 'filters: .github/filters/other.yml') } }), /deploy filter/);
  await assert.rejects(assertWorkflowContract(source, { workflowActions: pins, repositorySources: { ...repositorySources, deploy: repositorySources.deploy.replace('filters: .github/filters/deploy.yml', '# filters: .github/filters/deploy.yml') } }), /deploy filter/);
  await assert.rejects(assertWorkflowContract(source, { workflowActions: pins, repositorySources: { ...repositorySources, deployFilter: repositorySources.deployFilter.replace("  - 'infra/cwv-runner/**'\n", '') } }), /deploy filter/);
  await assert.rejects(assertWorkflowContract(source, { workflowActions: pins, repositorySources: { ...repositorySources, deployFilter: repositorySources.deployFilter.replace("cwv_runner:\n  - 'infra/cwv-runner/**'", "cwv_runner:\n  - 'infra/cwv-runner/**'\n  - 'infra/cwv-runner/**'") } }), /deploy filter/);
  await assert.rejects(assertWorkflowContract(source, { workflowActions: pins, repositorySources: { ...repositorySources, deployFilter: repositorySources.deployFilter.replace("migrations:\n", "migrations:\n  - 'infra/cwv-runner/**'\n") } }), /deploy filter/);
});

test('owned authority transport does not construct an immutable Authorization string', async () => {
  const runtime = await readFile(new URL('.github/scripts/cwv-runner-authority-runtime.mjs', root), 'utf8');
  assert.doesNotMatch(runtime, /authorization:\s*`Bearer\s+\$\{/i);
  assert.match(runtime, /finally\s*\{\s*authorization\.fill\(0\)/);
});

test('admission checks do not self-authenticate runner identity', async () => {
  const runtime = await readFile(new URL('.github/scripts/cwv-runner-authority-runtime.mjs', root), 'utf8');
  const start = runtime.indexOf('function allow(');
  const end = runtime.indexOf('\nfunction takeToken', start);
  assert.ok(start >= 0 && end > start, 'allow helper anchors must delimit its identity checks');
  const allow = runtime.slice(start, end);
  assert.doesNotMatch(allow, /, runner\) \{/);
  assert.doesNotMatch(allow, /value\.runner\.(?:id|generation|name) !== runner\./);
});

test('sealed authority validates the checked-out workflow without a bare YAML dependency', async () => {
  const runtime = await readFile(new URL('.github/scripts/cwv-runner-authority-runtime.mjs', root), 'utf8');
  const verificationStart = runtime.indexOf("if (args[0] === '--verify-and-project')");
  const verificationEnd = runtime.indexOf('authority = {');
  assert.ok(verificationStart >= 0 && verificationEnd >= 0 && verificationStart < verificationEnd, 'verification anchors must delimit the pre-revocation workflow check');
  const verification = runtime.slice(verificationStart, verificationEnd);
  assert.doesNotMatch(runtime, /(?:from|import\()\s*['"]yaml['"]/);
  assert.match(verification, /await assertWorkflowContract\(/);
  assert.match(verification, /GITHUB_WORKSPACE/);
});

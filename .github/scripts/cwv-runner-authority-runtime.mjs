// biome-ignore-all format: sealed authority bytes are mirrored into the runtime image.
// biome-ignore-all lint/suspicious/noTemplateCurlyInString: GitHub expression literals are compared verbatim.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as nodeFs from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import { dirname, join } from 'node:path';

import { canonicalJson, projectPublicAttestation, verifyPublicArtifact, verifyRunnerAuthority } from './cwv-runner-authority-core.mjs';
import { assertDeployFilterContract } from './cwv-runner-authority-filters.mjs';
import { readStableAttestation } from './cwv-runner-stable-attestation-builder.mjs';
import { parseRunnerPolicy } from './policy.schema.mjs';

const PINS = Object.freeze({
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
  uploadArtifact: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
  downloadArtifact: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
  createGithubAppToken: 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1',
});
const MODES = new Set(['--prepare-scratch', '--verify-and-project', '--verify-upload', '--verify-readback-and-clean', '--cleanup']);
const MEMBER = 'h0-runner-attestation.json';
const ALLOW = '/run/baci-cwv-admission/active.json';
const APP_SLUG = 'baci-cwv-runner-auditor';
const REQUESTED_PERMISSIONS = Object.freeze({ administration: 'read', metadata: 'read' });
const SHA = /^[a-f0-9]{64}$/;
const HOST_KEYS = ['schemaVersion', 'campaignId', 'captureSha256', 'policySha256', 'generation', 'runnerContainerId', 'runnerIp', 'runnerVeth', 'runnerPeerIfindex', 'externalInterface', 'externalIfindex', 'campaignMark', 'accountingTable', 'accountingIdentitySha256', 'nftSha256', 'cgroupSha256', 'dockerSha256', 'liveIdentity'];
const BINDING_KEYS = ['accountingIdentitySha256', 'accountingTable', 'campaignId', 'campaignMark', 'captureSha256', 'policySha256', 'generation', 'runnerContainerId', 'runnerIp', 'runnerVeth', 'runnerPeerIfindex', 'externalInterface', 'externalIfindex'];
const IDLE_KEYS = ['accepted', 'mode', 'campaignId', 'binding', 'thresholds', 'load1PerCpu', 'stealPercent', 'ambientIngressBytes', 'ambientEgressBytes', 'measurementIngressBytes', 'measurementEgressBytes', 'evidence'];
const NODE = 'exec /opt/runner/externals/node24/bin/node /opt/baci-cwv/cwv-runner-authority.mjs';
const GATE = 'exec /opt/runner/externals/node24/bin/node /opt/baci-cwv/runner-identity-gate.mjs';
const STEP_NAMES = ['Validate sealed runner admission', 'Create private authority scratch', 'Checkout exact reviewed source', 'Create read-only auditor token', 'Verify authority and write projection', 'Upload projected attestation', 'Verify uploaded artifact metadata', 'Download verified projected attestation', 'Verify projected artifact readback', 'Clean private state after platform token revocation registration'];
const fail = (message) => { throw new Error(message); };
const digest = (value) => createHash('sha256').update(value).digest('hex');
const actionArtifactDigest = (value) => { if (!SHA.test(value ?? '')) fail('artifact input refused'); return `sha256:${value}`; };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const mode = (stat) => stat.mode & 0o777;
const admission = (value) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/.test(value) && !/(?:token|secret|private|password)/i.test(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys, name) => { if (!object(value) || !same(Object.keys(value).sort(), [...keys].sort())) fail(`${name} refused`); };

function context(env) {
  const keys = ['RUNNER_TEMP', 'GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_ID', 'GITHUB_WORKFLOW', 'GITHUB_JOB', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_REF', 'RUNNER_NAME', 'RUNNER_OS', 'RUNNER_ARCH'];
  for (const key of keys) if (typeof env[key] !== 'string' || env[key] === '') fail(`missing ${key}`);
  if (!/^\d+$/.test(env.GITHUB_RUN_ID) || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT) || !/^\d+$/.test(env.GITHUB_REPOSITORY_ID) || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA) || env.GITHUB_WORKFLOW !== 'CWV Runner Attestation' || env.GITHUB_JOB !== 'attest') fail('invalid GitHub context');
  return { attempt: env.GITHUB_RUN_ATTEMPT, ref: env.GITHUB_REF, repository: env.GITHUB_REPOSITORY, repositoryId: Number(env.GITHUB_REPOSITORY_ID), runId: env.GITHUB_RUN_ID, runnerArch: env.RUNNER_ARCH, runnerName: env.RUNNER_NAME, runnerOs: env.RUNNER_OS, sha: env.GITHUB_SHA, temp: env.RUNNER_TEMP };
}

function assertPolicy(policy, run) {
  if (!object(policy) || policy.artifactRetentionDays !== 90 || policy.repository?.id !== run.repositoryId || policy.repository?.name !== run.repository || policy.runner?.name !== 'baci-cwv-measurement-01' || run.runnerName !== policy.runner.name || run.runnerOs !== 'Linux' || run.runnerArch !== 'X64' || !same(policy.workflowActions, PINS) || !same([...(policy.runner?.labels ?? [])].sort(), ['Linux', 'X64', 'baci-cwv-measurement', 'self-hosted'])) fail('policy binding refused');
}

export function assertWorkflowContract(text, policy) {
  return Promise.resolve().then(() => {
  const workflow = parseWorkflow(text);
  exact(workflow, ['concurrency', 'jobs', 'name', 'on', 'permissions', 'run-name'], 'workflow schema');
  if (workflow.name !== 'CWV Runner Attestation' || workflow['run-name'] !== 'CWV Runner Attestation ${{ inputs.admission_id }}' || !same(workflow.on, { workflow_dispatch: { inputs: { admission_id: { description: 'Exact-run admission nonce', required: true, type: 'string' } } } }) || !same(workflow.permissions, { actions: 'read', contents: 'read' }) || !same(workflow.concurrency, { group: 'cwv-runner-attestation', 'cancel-in-progress': false })) fail('workflow schema refused');
  exact(workflow.jobs, ['attest'], 'workflow job'); const job = workflow.jobs.attest;
  if (!object(job) || !same(Object.keys(job).sort(), ['runs-on', 'steps', 'timeout-minutes']) || !same(job['runs-on'], ['self-hosted', 'baci-cwv-measurement']) || job['timeout-minutes'] !== 20 || !Array.isArray(job.steps)) fail('workflow job refused');
  const steps = [{ name: STEP_NAMES[0], env: { BACI_CWV_ADMISSION_ID: '${{ inputs.admission_id }}' }, run: GATE }, { name: STEP_NAMES[1], env: { BACI_CWV_ADMISSION_ID: '${{ inputs.admission_id }}', BACI_CWV_HOST_EVIDENCE_DIR: '/host-evidence' }, run: `${NODE} --prepare-scratch` }, { name: STEP_NAMES[2], uses: PINS.checkout, with: { ref: '${{ github.sha }}', 'persist-credentials': false } }, { name: STEP_NAMES[3], id: 'auditor-token', uses: PINS.createGithubAppToken, with: { 'client-id': '${{ vars.BACI_CWV_RUNNER_AUDITOR_CLIENT_ID }}', 'private-key': '${{ secrets.BACI_CWV_RUNNER_AUDITOR_PRIVATE_KEY }}', owner: 'ogabasseyy', repositories: 'Baci', 'permission-administration': 'read', 'permission-metadata': 'read', 'github-api-url': 'https://api.github.com' } }, { name: STEP_NAMES[4], env: { BACI_CWV_AUDITOR_TOKEN: '${{ steps.auditor-token.outputs.token }}', BACI_CWV_AUDITOR_INSTALLATION_ID: '${{ steps.auditor-token.outputs.installation-id }}', BACI_CWV_AUDITOR_APP_SLUG: '${{ steps.auditor-token.outputs.app-slug }}', BACI_CWV_EXPECTED_APP_SLUG: APP_SLUG, BACI_CWV_EXPECTED_INSTALLATION_ID: '${{ vars.BACI_CWV_RUNNER_AUDITOR_INSTALLATION_ID }}', BACI_CWV_HOST_EVIDENCE_DIR: '/host-evidence', BACI_CWV_POLICY_PATH: '/opt/baci-cwv/policy.json' }, run: `${NODE} --verify-and-project` }, { name: STEP_NAMES[5], id: 'upload-attestation', uses: PINS.uploadArtifact, with: { name: 'h0-runner-attestation-${{ github.run_id }}-${{ github.run_attempt }}', path: '${{ runner.temp }}/cwv-runner-projection/h0-runner-attestation.json', 'retention-days': 90, 'if-no-files-found': 'error' } }, { name: STEP_NAMES[6], env: { BACI_CWV_ARTIFACT_ID: '${{ steps.upload-attestation.outputs.artifact-id }}', BACI_CWV_ARTIFACT_DIGEST: '${{ steps.upload-attestation.outputs.artifact-digest }}', BACI_CWV_ARTIFACT_TOKEN: '${{ github.token }}' }, run: `${NODE} --verify-upload` }, { name: STEP_NAMES[7], uses: PINS.downloadArtifact, with: { 'artifact-ids': '${{ steps.upload-attestation.outputs.artifact-id }}', path: '${{ runner.temp }}/cwv-runner-readback' } }, { name: STEP_NAMES[8], run: `${NODE} --verify-readback-and-clean` }, { name: STEP_NAMES[9], if: '${{ always() }}', run: `${NODE} --cleanup` }];
  if (!same(job.steps, steps)) fail('workflow step graph refused');
  if (policy?.workflowActions && !same(policy.workflowActions, PINS)) fail('workflow pins refused');
  if (policy?.repositorySources) assertRepositoryClosure(policy.repositorySources, text);
  });
}

function parseWorkflow(text) {
  if (typeof text !== 'string') fail('workflow schema refused');
  const tokens = [];
  for (const raw of text.split('\n')) {
    if (raw === '') continue;
    const match = /^( *)(- )?([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(raw);
    if (!match || raw.endsWith(' ') || /[\t#&*!|>]|<<:/.test(raw) || match[1].length % 2 || (match[4] !== '' && !match[4].startsWith(' '))) fail('workflow schema refused');
    tokens.push({ dash: Boolean(match[2]), indent: match[1].length, key: match[3], value: match[4].trim() });
  }
  if (!tokens.length) fail('workflow schema refused');
  const root = {}; const frames = [{ indent: -1, value: root }];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]; while (frames.at(-1).indent >= token.indent) frames.pop(); const parent = frames.at(-1)?.value;
    if (!parent || token.indent !== frames.at(-1).indent + 2 && frames.at(-1).indent !== -1) fail('workflow schema refused');
    const target = token.dash ? (() => { if (!Array.isArray(parent)) fail('workflow schema refused'); const item = {}; parent.push(item); frames.push({ indent: token.indent, value: item }); return item; })() : parent;
    if (!object(target) || Object.hasOwn(target, token.key)) fail('workflow schema refused');
    if (token.value === '') { const next = tokens[index + 1]; if (!next || next.indent !== token.indent + 2) fail('workflow schema refused'); target[token.key] = next.dash ? [] : {}; frames.push({ indent: token.indent, value: target[token.key] }); }
    else target[token.key] = scalar(token.value);
  }
  return root;
}
function scalar(value) { if (value === 'true') return true; if (value === 'false') return false; if (/^\d+$/.test(value)) return Number(value); if (/^\[[A-Za-z0-9_.-]+(?:, [A-Za-z0-9_.-]+)*\]$/.test(value)) return value.slice(1, -1).split(', '); if (/^"[^"\\]*"$/.test(value)) return value.slice(1, -1); if (!/^[-A-Za-z0-9_./:@${}=()]+(?: [-A-Za-z0-9_./:@${}=()]+)*$/.test(value)) fail('workflow schema refused'); return value; }

function localImports(source) { return [...source.matchAll(/(?:import|export)[^'"`]*['"](\.\/[^'"]+)['"]/g)].map((match) => match[1]).sort(); }
function assertRepositoryClosure(sources, workflowText) {
  if (!object(sources) || typeof sources.actionlint !== 'string' || typeof sources.actionlintWorkflow !== 'string' || typeof sources.deploy !== 'string' || typeof sources.deployFilter !== 'string' || !object(sources.workflows) || !object(sources.authoritySources)) fail('source closure refused');
  if (sources.actionlint.trim() !== 'self-hosted-runner:\n  labels:\n    - baci-android\n    - baci-deploy\n    - baci-lighthouse\n    - baci-cwv-measurement' || !sources.actionlintWorkflow.includes('.github/actionlint.yaml')) fail('actionlint refused');
  const selectorCount = Object.values(sources.workflows).join('').split('baci-cwv-measurement').length - 1;
  if (sources.workflows['cwv-runner-attestation.yml'] !== workflowText || selectorCount !== 1) fail('measurement selector refused');
  assertDeployFilterContract(sources.deploy, sources.deployFilter);
  const { authority, canonical, core, policy, runtime, stable } = sources.authoritySources;
  const filters = sources.authoritySources.filters;
  if (![authority, canonical, core, filters, policy, runtime, stable].every((source) => typeof source === 'string') || !same(localImports(authority), ['./cwv-runner-authority-core.mjs', './cwv-runner-authority-runtime.mjs']) || !same(localImports(canonical), []) || !same(localImports(core), []) || !same(localImports(filters), []) || !same(localImports(policy), ['./canonical-json.mjs']) || !same(localImports(runtime), ['./cwv-runner-authority-core.mjs', './cwv-runner-authority-filters.mjs', './cwv-runner-stable-attestation-builder.mjs', './policy.schema.mjs']) || !same(localImports(stable), ['./cwv-runner-authority-core.mjs'])) fail('source closure refused');
}

async function checkedRepositorySources(fs, workspace) {
  if (typeof workspace !== 'string' || !workspace.startsWith('/') || workspace.includes('..')) fail('checked source refused');
  const read = async (path) => { try { const bytes = await fs.readFile(join(workspace, path), 'utf8'); if (typeof bytes !== 'string' || bytes.length > 1_048_576) fail('checked source refused'); return bytes; } catch { fail('checked source refused'); } };
  const workflowNames = await fs.readdir(join(workspace, '.github/workflows'));
  const workflows = Object.fromEntries(await Promise.all(workflowNames.filter((name) => /\.ya?ml$/i.test(name)).map(async (name) => [name, await read(`.github/workflows/${name}`)])));
  return { actionlint: await read('.github/actionlint.yaml'), actionlintWorkflow: await read('.github/workflows/actionlint.yml'), authoritySources: { authority: await read('.github/scripts/cwv-runner-authority.mjs'), canonical: await read('.github/scripts/canonical-json.mjs'), core: await read('.github/scripts/cwv-runner-authority-core.mjs'), filters: await read('.github/scripts/cwv-runner-authority-filters.mjs'), policy: await read('.github/scripts/policy.schema.mjs'), runtime: await read('.github/scripts/cwv-runner-authority-runtime.mjs'), stable: await read('.github/scripts/cwv-runner-stable-attestation-builder.mjs') }, deploy: await read('.github/workflows/deploy.yml'), deployFilter: await read('.github/filters/deploy.yml'), workflows };
}

export function createGithubTransport({ request: requestImpl = httpsRequest, setTimeout: setDeadline = setTimeout, clearTimeout: clearDeadline = clearTimeout } = {}) {
  return { request({ method, path, token }) {
    if (!Buffer.isBuffer(token) || token.length < 1 || !['DELETE', 'GET'].includes(method) || !/^\/[A-Za-z0-9?&=._/-]+$/.test(path)) fail('GitHub request refused');
    const authorization = Buffer.concat([Buffer.from('Bearer '), token]);
    return new Promise((resolve, reject) => {
      let request; let deadline; let settled = false;
      const settle = (callback, value) => { if (!settled) { settled = true; clearDeadline(deadline); callback(value); } };
      try {
        deadline = setDeadline(() => { const error = new Error('GitHub request timed out'); request?.destroy(error); settle(reject, error); }, 5000);
        if (settled) { clearDeadline(deadline); return; }
        request = requestImpl({ headers: { accept: 'application/vnd.github+json', authorization, 'user-agent': 'baci-cwv-authority', 'x-github-api-version': '2022-11-28' }, hostname: 'api.github.com', method, path, port: 443, protocol: 'https:' }, (response) => {
          const chunks = []; let length = 0;
          response.on('data', (chunk) => { length += chunk.length; if (length > 4_194_304) response.destroy(new Error('GitHub response too large')); else chunks.push(chunk); });
          response.on('error', (error) => settle(reject, error));
          response.on('end', () => {
            const bytes = Buffer.concat(chunks); const status = response.statusCode;
            let body = null; try { if (bytes.length) body = JSON.parse(bytes.toString('utf8')); } catch { settle(reject, new Error('GitHub response invalid')); return; }
            if (!Number.isInteger(status)) { settle(reject, new Error('GitHub status missing')); return; }
            if (status >= 200 && status < 300) settle(resolve, { body, status });
            else { const error = new Error(`GitHub ${status}`); error.status = status; error.body = body; settle(reject, error); }
          });
        });
        request.on('error', (error) => settle(reject, error)); request.end();
      } catch (error) { settle(reject, error); }
      finally { authorization.fill(0); }
    });
  } };
}

function identity(stat) { return `${stat.dev}:${stat.ino}:${stat.uid}:${mode(stat)}`; }
async function sealedJson(fs, path, name) {
  try {
    const before = await fs.lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) fail(`invalid ${name}`);
    const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.isSymbolicLink() || identity(before) !== identity(opened)) fail(`invalid ${name}`);
      const raw = (await handle.readFile()).toString('utf8'); const after = await handle.stat(); const named = await fs.lstat(path);
      if (identity(before) !== identity(after) || identity(before) !== identity(named)) fail(`invalid ${name}`);
      const value = JSON.parse(raw);
      if (raw !== canonicalJson(value)) fail(`invalid ${name}`);
      return { raw, value };
    } finally { await handle.close(); }
  } catch (error) { if (error instanceof Error && error.message === `invalid ${name}`) throw error; fail(`invalid ${name}`); }
}
async function json(fs, path, name) { try { const raw = await fs.readFile(path, 'utf8'); return { raw, value: JSON.parse(raw) }; } catch { fail(`invalid ${name}`); } }
async function directory(fs, path, uid) { await fs.mkdir(path, { mode: 0o700 }); await fs.chmod(path, 0o700); const stat = await fs.lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || mode(stat) !== 0o700) fail('private directory refused'); }
async function write(fs, path, value, uid, fileMode) { await fs.writeFile(path, value, { encoding: 'utf8', flag: 'wx', mode: fileMode }); await fs.chmod(path, fileMode); const stat = await fs.lstat(path); if (!stat.isFile() || stat.uid !== uid || mode(stat) !== fileMode) fail('private file refused'); }
async function request(transportClient, token, method, path, expectedStatus = 200) {
  const response = await transportClient.request({ method, path, token });
  if (!object(response) || response.status !== expectedStatus || !('body' in response)) fail(`GitHub ${expectedStatus} response refused`);
  return response.body;
}
async function pages(transportClient, token, path, key, counted = false) {
  const rows = []; const ids = new Set(); let total;
  for (let page = 1; page <= 100; page += 1) {
    const value = await request(transportClient, token, 'GET', `${path}?per_page=100&page=${page}`); const current = Array.isArray(value) ? value : value?.[key];
    if (!Array.isArray(current) || counted && (!Number.isInteger(value.total_count) || value.total_count < 0 || total !== undefined && total !== value.total_count)) fail(`${key} pagination refused`);
    for (const row of current) { if (!Number.isInteger(row?.id) || ids.has(row.id)) fail(`${key} pagination refused`); ids.add(row.id); rows.push(row); }
    if (counted) total = value.total_count;
    if (current.length < 100) { if (counted && rows.length !== total) fail(`${key} pagination refused`); return rows; }
  }
  fail(`${key} pagination refused`);
}
async function member(fs, directory) {
  const root = await fs.lstat(directory); if (!root.isDirectory() || root.isSymbolicLink() || !same((await fs.readdir(directory)).sort(), [MEMBER])) fail('artifact members refused');
  const path = join(directory, MEMBER); const initial = await fs.lstat(path); if (!initial.isFile() || initial.isSymbolicLink()) fail('artifact member refused');
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.isSymbolicLink() || mode(stat) !== 0o644) fail('artifact member refused'); return { bytes: await handle.readFile(), mode: mode(stat), name: MEMBER, type: 'file' }; } finally { await handle.close(); }
}

function liveIdentity(host, idle) {
  const value = host.liveIdentity; exact(value, ['classifier', 'container', 'idleContainerSha256', 'nftSha256'], 'live identity'); exact(value.classifier, ['handle', 'sha256'], 'classifier identity'); exact(value.container, ['cgroup', 'expectedImage', 'expectedNetwork', 'id', 'image', 'networkMode', 'pid', 'running'], 'container identity');
  if (!Number.isSafeInteger(value.classifier.handle) || value.classifier.handle < 1 || !SHA.test(value.classifier.sha256) || !SHA.test(value.idleContainerSha256) || !SHA.test(value.nftSha256) || value.container.id !== host.runnerContainerId || value.container.image !== value.container.expectedImage || value.container.networkMode !== 'baci-cwv-net' || value.container.expectedNetwork !== 'baci-cwv-net' || value.container.running !== true || !Number.isSafeInteger(value.container.pid) || value.container.pid < 2 || typeof value.container.cgroup !== 'string' || !value.container.cgroup.startsWith('/cwv-measurement.slice/') || !/^sha256:[a-f0-9]{64}$/.test(value.container.expectedImage) || value.nftSha256 !== host.nftSha256 || value.idleContainerSha256 !== idle.evidence?.container?.end || value.nftSha256 !== idle.evidence?.nft?.end) fail('live identity refused');
}

function live(value, policy, policyFileSha256, now) {
  exact(value, ['schemaVersion', 'capturedAt', 'campaignId', 'collectors', 'host', 'idle'], 'host evidence');
  exact(value.collectors, ['host', 'idle'], 'collectors'); exact(value.collectors.host, ['ok', 'sha256'], 'host collector'); exact(value.collectors.idle, ['ok', 'sha256'], 'idle collector'); exact(value.host, HOST_KEYS, 'host evidence'); exact(value.idle, IDLE_KEYS, 'idle evidence'); exact(value.idle.binding, BINDING_KEYS, 'idle binding');
  liveIdentity(value.host, value.idle);
  if (value.schemaVersion !== 1 || typeof value.campaignId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(value.campaignId) || value.collectors.host.ok !== true || value.collectors.idle.ok !== true || !SHA.test(value.collectors.host.sha256) || !SHA.test(value.collectors.idle.sha256)) fail('host evidence refused');
  const captured = Date.parse(value.capturedAt);
  if (!Number.isFinite(captured) || new Date(captured).toISOString() !== value.capturedAt || Math.abs(now().getTime() - captured) > 15_000 || value.host.schemaVersion !== 1 || value.host.campaignId !== value.campaignId || value.host.policySha256 !== policyFileSha256 || !Number.isInteger(value.host.generation) || value.host.generation !== 1 || !/^[a-f0-9]{64}$/.test(value.host.runnerContainerId) || !Number.isSafeInteger(value.host.runnerPeerIfindex) || !Number.isSafeInteger(value.host.externalIfindex) || !Number.isSafeInteger(value.host.campaignMark) || ![value.host.captureSha256, value.host.accountingIdentitySha256, value.host.nftSha256, value.host.cgroupSha256, value.host.dockerSha256].every((entry) => SHA.test(entry)) || value.idle.accepted !== true || value.idle.mode !== 'live' || value.idle.campaignId !== value.campaignId || !same(value.idle.thresholds, policy.thresholds) || !Number.isFinite(value.idle.load1PerCpu) || !Number.isFinite(value.idle.stealPercent) || ![value.idle.ambientIngressBytes, value.idle.ambientEgressBytes, value.idle.measurementIngressBytes, value.idle.measurementEgressBytes].every((entry) => Number.isSafeInteger(entry) && entry >= 0)) fail('live sample refused');
  for (const key of BINDING_KEYS) if (value.idle.binding[key] !== value.host[key]) fail('campaign binding refused');
  if (value.collectors.host.sha256 !== digest(canonicalJson(value.host)) || value.collectors.idle.sha256 !== digest(canonicalJson(value.idle))) fail('collector digest refused');
  return value;
}

function allow(value, run, admissionId, policyFileSha256, campaignId) {
  exact(value, ['admissionId', 'campaignId', 'expectedSha', 'expiresMonotonicSeconds', 'kind', 'policyFileSha256', 'repository', 'run', 'runner', 'schemaVersion', 'workflow'], 'allow record'); exact(value.repository, ['id', 'name'], 'allow repository'); exact(value.run, ['attempt', 'id'], 'allow run'); exact(value.runner, ['generation', 'id', 'name'], 'allow runner'); exact(value.workflow, ['id', 'job', 'path', 'ref'], 'allow workflow');
  if (value.schemaVersion !== 1 || value.kind !== 'allow' || value.admissionId !== admissionId || value.campaignId !== campaignId || value.expectedSha !== run.sha || value.policyFileSha256 !== policyFileSha256 || value.repository.id !== run.repositoryId || value.repository.name !== run.repository || value.run.id !== Number(run.runId) || value.run.attempt !== Number(run.attempt) || value.runner.generation !== 1 || value.runner.name !== run.runnerName || value.workflow.job !== 'attest' || value.workflow.path !== '.github/workflows/cwv-runner-attestation.yml' || value.workflow.ref !== 'refs/heads/main') fail('allow binding refused');
}

function takeToken(env, key) {
  if (typeof env[key] !== 'string' || env[key] === '') fail('token input refused');
  const token = Buffer.from(env[key], 'utf8'); env[key] = ''; delete env[key]; return token;
}
async function revoke(transportClient, token) {
  const body = await request(transportClient, token, 'DELETE', '/installation/token', 204);
  if (body !== null) fail('GitHub 204 response refused');
  try { await transportClient.request({ method: 'GET', path: '/installation/repositories?per_page=100&page=1', token }); fail('revoked token remained valid'); } catch (error) { if (error?.status !== 401) throw error; }
}

function safeDirectory(stat, uid, fileMode, label) { if (!stat?.isDirectory() || stat.isSymbolicLink() || stat.uid !== uid || mode(stat) !== fileMode) fail(`${label} unavailable`); return identity(stat); }
async function checkedDirectory(fs, path, uid, fileMode, label, expected) {
  try { const before = await fs.lstat(path); const current = safeDirectory(before, uid, fileMode, label); if (expected !== undefined && current !== expected) fail(`${label} unavailable`); const handle = await fs.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { if (safeDirectory(await handle.stat(), uid, fileMode, label) !== current || safeDirectory(await fs.lstat(path), uid, fileMode, label) !== current) fail(`${label} unavailable`); return current; } finally { await handle.close(); } } catch (error) { if (error?.code === 'ENOENT') return null; if (error instanceof Error && error.message === `${label} unavailable`) throw error; fail(`${label} unavailable`); }
}
async function checkedPrivateFile(fs, path, uid, fileMode, label, expected) {
  try { const before = await fs.lstat(path); if (!before.isFile() || before.isSymbolicLink() || before.uid !== uid || mode(before) !== fileMode || !Number.isSafeInteger(before.size) || before.size < 0 || before.size > 4_194_304) fail(`${label} refused`); const current = identity(before); if (expected !== undefined && current !== expected) fail(`${label} refused`); const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const opened = await handle.stat(); const after = await fs.lstat(path); if (!opened.isFile() || opened.isSymbolicLink() || identity(opened) !== current || identity(after) !== current || opened.size !== before.size) fail(`${label} refused`); return { bytes: await handle.readFile(), identity: current, size: before.size }; } finally { await handle.close(); } } catch (error) { if (error?.code === 'ENOENT') return null; if (error instanceof Error && error.message === `${label} refused`) throw error; fail(`${label} refused`); }
}
async function sealReadback(fs, path, uid) {
  try { const before = await fs.lstat(path); if (!before.isDirectory() || before.isSymbolicLink() || before.uid !== uid || ![0o700, 0o755].includes(mode(before))) fail('private readback unavailable'); const current = `${before.dev}:${before.ino}:${before.uid}`; const handle = await fs.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { const opened = await handle.stat(); if (!opened.isDirectory() || opened.isSymbolicLink() || `${opened.dev}:${opened.ino}:${opened.uid}` !== current) fail('private readback unavailable'); if (mode(opened) !== 0o700) await handle.chmod(0o700); const after = await handle.stat(); const named = await fs.lstat(path); if (`${after.dev}:${after.ino}:${after.uid}` !== current || identity(after) !== identity(named) || mode(after) !== 0o700) fail('private readback unavailable'); } finally { await handle.close(); } } catch (error) { if (error instanceof Error && error.message === 'private readback unavailable') throw error; fail('private readback unavailable'); }
}
async function syncDirectory(fs, path) { const handle = await fs.open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); try { await handle.sync(); } finally { await handle.close(); } }
async function zeroAndUnlink(fs, path, uid, fileMode, label) {
  const proof = await checkedPrivateFile(fs, path, uid, fileMode, label); if (proof === null) return;
  const handle = await fs.open(path, constants.O_RDWR | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.isSymbolicLink() || identity(stat) !== proof.identity || stat.size !== proof.size) fail(`${label} refused`); const result = await handle.write(Buffer.alloc(proof.size), 0, proof.size, 0); if (result.bytesWritten !== proof.size) fail(`${label} refused`); await handle.sync(); } finally { await handle.close(); }
  const erased = await checkedPrivateFile(fs, path, uid, fileMode, label, proof.identity); if (erased === null || erased.size !== proof.size || !erased.bytes.every((byte) => byte === 0)) fail(`${label} refused`);
  await fs.unlink(path); await syncDirectory(fs, dirname(path));
}
async function wipeDirectory(fs, path, uid, names, fileMode, label) {
  const identity = await checkedDirectory(fs, path, uid, 0o700, label); if (identity === null) return;
  const listed = (await fs.readdir(path)).sort(); if (!listed.every((name) => names.includes(name))) fail(`${label} refused`);
  for (const name of listed) { if (await checkedDirectory(fs, path, uid, 0o700, label, identity) === null) return; await zeroAndUnlink(fs, join(path, name), uid, fileMode, label); }
  if (await checkedDirectory(fs, path, uid, 0o700, label, identity) === null) return; if ((await fs.readdir(path)).length !== 0) fail(`${label} refused`); await fs.rmdir(path); await syncDirectory(fs, dirname(path));
}
async function wipe(fs, run, uid) {
  await wipeDirectory(fs, join(run.temp, 'cwv-runner-readback'), uid, [MEMBER], 0o644, 'private readback');
  await wipeDirectory(fs, join(run.temp, 'cwv-runner-projection'), uid, [MEMBER], 0o644, 'private projection');
  await wipeDirectory(fs, join(run.temp, 'cwv-runner-private'), uid, ['admission.json', 'app-authority.json', 'projection-proof.json', 'upload-proof.json'], 0o600, 'private scratch');
}

export async function runAuthorityCli({ args, env = process.env, fs = nodeFs, transport: transportClient = createGithubTransport(), uid = process.getuid(), now = () => new Date() }) {
  if (!Array.isArray(args) || args.length !== 1 || !MODES.has(args[0])) fail('expected one authority mode');
  const token = args[0] === '--verify-and-project' ? takeToken(env, 'BACI_CWV_AUDITOR_TOKEN') : null;
  let run; let scratch; let projected; let authority;
  try {
  run = context(env); scratch = join(run.temp, 'cwv-runner-private'); projected = join(run.temp, 'cwv-runner-projection');
  if (args[0] === '--cleanup') { await wipe(fs, run, uid); return; }
  if (args[0] === '--prepare-scratch') {
    if (!admission(env.BACI_CWV_ADMISSION_ID) || env.BACI_CWV_HOST_EVIDENCE_DIR !== '/host-evidence') fail('scratch binding refused');
    const admissionDocument = await sealedJson(fs, ALLOW, 'admission record');
    if (admissionDocument.value.admissionId !== env.BACI_CWV_ADMISSION_ID) fail('admission record refused');
    allow(admissionDocument.value, run, env.BACI_CWV_ADMISSION_ID, admissionDocument.value.policyFileSha256, admissionDocument.value.campaignId);
    await directory(fs, scratch, uid); await write(fs, join(scratch, 'admission.json'), admissionDocument.raw, uid, 0o600); return;
  }
  if (await checkedDirectory(fs, scratch, uid, 0o700, 'private scratch') === null) fail('private scratch unavailable');
  if (args[0] === '--verify-and-project') {
      if (!/^\d+$/.test(env.BACI_CWV_AUDITOR_INSTALLATION_ID ?? '') || env.BACI_CWV_AUDITOR_INSTALLATION_ID !== env.BACI_CWV_EXPECTED_INSTALLATION_ID || env.BACI_CWV_AUDITOR_APP_SLUG !== APP_SLUG || env.BACI_CWV_EXPECTED_APP_SLUG !== APP_SLUG || env.BACI_CWV_HOST_EVIDENCE_DIR !== '/host-evidence' || env.BACI_CWV_POLICY_PATH !== '/opt/baci-cwv/policy.json') fail('App token binding refused');
      const frozenAdmission = await sealedJson(fs, join(scratch, 'admission.json'), 'admission record'); const admissionRecord = frozenAdmission.value;
      if (!admission(admissionRecord.admissionId)) fail('admission record refused');
      const rawPolicyDocument = await json(fs, env.BACI_CWV_POLICY_PATH, 'policy'); const policyDocument = { ...rawPolicyDocument, value: parseRunnerPolicy(rawPolicyDocument.value) }; assertPolicy(policyDocument.value, run);
      const tokenAuthority = { appSlug: env.BACI_CWV_AUDITOR_APP_SLUG, installationId: Number(env.BACI_CWV_AUDITOR_INSTALLATION_ID), repository: policyDocument.value.repository, requestedPermissions: REQUESTED_PERMISSIONS };
      const repositorySources = await checkedRepositorySources(fs, env.GITHUB_WORKSPACE);
      await assertWorkflowContract(repositorySources.workflows['cwv-runner-attestation.yml'], {
        repositorySources,
        workflowActions: policyDocument.value.workflowActions,
      });
      const policyFileSha256 = digest(policyDocument.raw); allow(admissionRecord, run, admissionRecord.admissionId, policyFileSha256, admissionRecord.campaignId);
      const stable = await readStableAttestation({ fs, policyFileSha256, runner: frozenAdmission.value.runner });
      const prefix = `/repos/${run.repository}`; const inventory = await pages(transportClient, token, `${prefix}/actions/runners`, 'runners', true); const retention = await request(transportClient, token, 'GET', `${prefix}/actions/permissions/artifact-and-log-retention`); const repositories = await pages(transportClient, token, '/installation/repositories', 'repositories', true); const rulesets = await pages(transportClient, token, `${prefix}/rulesets`, 'rulesets');
      if (repositories.length !== 1 || repositories[0]?.id !== tokenAuthority.repository.id || repositories[0]?.full_name !== tokenAuthority.repository.name) fail('App authority refused');
      const matches = rulesets.filter((candidate) => candidate?.name === policyDocument.value.ruleset.name); if (matches.length !== 1 || !Number.isInteger(matches[0]?.id)) fail('ruleset inventory refused');
      const ruleset = await request(transportClient, token, 'GET', `${prefix}/rulesets/${matches[0].id}`); if (ruleset?.id !== matches[0].id) fail('ruleset readback refused');
      const findings = verifyRunnerAuthority({ appPermissions: tokenAuthority.requestedPermissions, artifactLifetimeSeconds: policyDocument.value.artifactRetentionDays * 86400, localAttestation: { runnerGeneration: stable.runnerGeneration, runnerId: stable.runnerId, workerCount: stable.workerCount }, policy: policyDocument.value, repositoryRetention: retention, ruleset, runnerInventory: inventory, workflowRetentionDays: policyDocument.value.artifactRetentionDays });
      if (findings.length) fail(`runner authority failed: ${findings.map(({ code }) => code).join(',')}`);
    const effectiveAppAuthority = { ...tokenAuthority, capabilities: { artifactRetention: true, repositoryInventory: true, rulesetInventory: true, rulesetReadback: true, runnerInventory: true } }; authority = { effectiveAppAuthority, frozenAdmission, inventory, policyDocument, retention, ruleset, stable, tokenAuthority };
  } else if (args[0] === '--verify-upload') {
    if (!/^\d+$/.test(env.BACI_CWV_ARTIFACT_ID ?? '')) fail('artifact input refused'); const actionDigest = actionArtifactDigest(env.BACI_CWV_ARTIFACT_DIGEST);
    const projectedMember = await member(fs, projected); const bytes = projectedMember.bytes; verifyPublicArtifact({ members: [projectedMember] }); const proof = (await json(fs, join(scratch, 'projection-proof.json'), 'projection proof')).value;
    if (!SHA.test(proof.memberSha256) || proof.memberSha256 !== digest(bytes)) fail('projection proof refused');
    const token = takeToken(env, 'BACI_CWV_ARTIFACT_TOKEN');
    try {
      const artifact = await request(transportClient, token, 'GET', `/repos/${run.repository}/actions/artifacts/${env.BACI_CWV_ARTIFACT_ID}`); const age = Date.parse(artifact.expires_at) - Date.parse(artifact.created_at);
      if (artifact.id !== Number(env.BACI_CWV_ARTIFACT_ID) || artifact.name !== `h0-runner-attestation-${run.runId}-${run.attempt}` || artifact.digest !== actionDigest || artifact.workflow_run?.id !== Number(run.runId) || artifact.expired !== false || !Number.isFinite(age) || Math.abs(age - 90 * 86400000) > 300000) fail('artifact receipt refused');
      await write(fs, join(scratch, 'upload-proof.json'), canonicalJson({ artifactDigest: artifact.digest, artifactId: artifact.id, memberSha256: proof.memberSha256 }), uid, 0o600); return;
    } finally { token.fill(0); }
  } else { const readback = join(run.temp, 'cwv-runner-readback'); await sealReadback(fs, readback, uid); const readbackMember = await member(fs, readback); const bytes = readbackMember.bytes; verifyPublicArtifact({ members: [readbackMember] }); const proof = (await json(fs, join(scratch, 'upload-proof.json'), 'upload proof')).value;
  if (proof.memberSha256 !== digest(bytes) || !/^\d+$/.test(String(proof.artifactId)) || !/^sha256:[a-f0-9]{64}$/.test(proof.artifactDigest)) fail('artifact readback refused'); await wipe(fs, run, uid);
  }
  } finally { if (token !== null) { try { await revoke(transportClient, token); } finally { token.fill(0); delete env.BACI_CWV_AUDITOR_INSTALLATION_ID; delete env.BACI_CWV_AUDITOR_APP_SLUG; } } }
  if (args[0] === '--verify-and-project') {
    const { effectiveAppAuthority, frozenAdmission, inventory, policyDocument, retention, ruleset, stable, tokenAuthority } = authority; const policyFileSha256 = digest(policyDocument.raw); const sample = live((await json(fs, '/host-evidence/live-sample.json', 'live sample')).value, policyDocument.value, policyFileSha256, now); allow(frozenAdmission.value, run, frozenAdmission.value.admissionId, policyFileSha256, sample.campaignId);
    await write(fs, join(scratch, 'app-authority.json'), canonicalJson({ effectiveAppAuthority, tokenAuthority }), uid, 0o600); await directory(fs, projected, uid);
    const privateInput = { repository: policyDocument.value.repository, workflow: { attempt: Number(run.attempt), headSha: run.sha, job: 'attest', publicRunUrl: `https://github.com/${run.repository}/actions/runs/${run.runId}`, ref: run.ref, runId: Number(run.runId) }, runner: { generation: stable.runnerGeneration, id: stable.runnerId, name: policyDocument.value.runner.name }, resources: stable.resources, retention: { artifactLifetimeSeconds: policyDocument.value.artifactRetentionDays * 86400, maximumAllowedDays: retention.maximum_allowed_days, repositoryDays: retention.days, workflowDays: policyDocument.value.artifactRetentionDays }, digests: { ...stable.digests, admissionSha256: digest(frozenAdmission.raw), appPermissionsSha256: digest(canonicalJson(tokenAuthority.requestedPermissions)), liveSampleSha256: digest(canonicalJson(sample)), policyFileSha256, rulesetSha256: digest(canonicalJson(ruleset)), runnerInventorySha256: digest(canonicalJson(inventory)) }, failureMatrix: stable.failureMatrix, noMeasurement: true };
    const bytes = canonicalJson(projectPublicAttestation(privateInput)); await write(fs, join(projected, MEMBER), bytes, uid, 0o644); await write(fs, join(scratch, 'projection-proof.json'), canonicalJson({ memberSha256: digest(bytes), policyFileSha256 }), uid, 0o600);
  }
}

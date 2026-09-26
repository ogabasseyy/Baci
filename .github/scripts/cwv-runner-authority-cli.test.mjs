import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildLiveSample } from '../../infra/cwv-runner/host-sample-publisher.mjs';
import { parseRunnerPolicy } from '../../infra/cwv-runner/policy.schema.mjs';
import { runAuthorityCli } from './cwv-runner-authority-runtime.mjs';
const sha = 'a'.repeat(64); const temp = '/runner-temp'; const scratch = `${temp}/cwv-runner-private`; const projection = `${temp}/cwv-runner-projection`; const policyPath = '/opt/baci-cwv/policy.json';
const workspace = '/workspace'; const root = new URL('../..', import.meta.url);
const checkedSources = Object.fromEntries([
  '.github/actionlint.yaml', '.github/filters/deploy.yml',
  '.github/scripts/cwv-runner-authority.mjs', '.github/scripts/canonical-json.mjs', '.github/scripts/cwv-runner-authority-core.mjs', '.github/scripts/cwv-runner-authority-filters.mjs', '.github/scripts/cwv-runner-authority-runtime.mjs', '.github/scripts/policy.schema.mjs', '.github/scripts/cwv-runner-stable-attestation-builder.mjs',
  ...readdirSync(new URL('.github/workflows/', root)).filter((name) => /^[a-z0-9][a-z0-9-]*\.ya?ml$/.test(name)).map((name) => `.github/workflows/${name}`),
].map((path) => [`${workspace}/${path}`, readFileSync(new URL(path, root), 'utf8')]));
const pins = { checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', uploadArtifact: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', downloadArtifact: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c', createGithubAppToken: 'actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1' };
const raw = readFileSync(new URL('../../infra/cwv-runner/policy.json', import.meta.url), 'utf8');
const policy = parseRunnerPolicy(JSON.parse(raw));
class FakeFs {
  constructor(files) { this.nextIno = 1; this.files = new Map(Object.entries(files).map(([path, value]) => [path, this.entry(value, 0o644)])); this.directories = new Map([[temp, this.entry('', 0o700)]]); this.opened = []; this.syncs = []; this.writes = []; }
  entry(bytes, mode, uid = 501, gid = uid) { return { bytes: Buffer.from(bytes), dev: 1, gid, ino: this.nextIno++, mode, uid }; }
  stat(value, isFile) { return { dev: value.dev, gid: value.gid, ino: value.ino, uid: value.uid, mode: value.mode, size: isFile ? value.bytes.length : 0, isFile: () => isFile, isDirectory: () => !isFile, isSymbolicLink: () => value.symlink === true }; }
  async mkdir(path, { mode = 0o777 } = {}) { if (this.directories.has(path) || this.files.has(path)) throw new Error('exists'); this.directories.set(path, this.entry('', mode)); }
  async rm(path) { for (const key of [...this.files.keys(), ...this.directories.keys()]) if (key === path || key.startsWith(`${path}/`)) { this.files.delete(key); this.directories.delete(key); } }
  async writeFile(path, value, { flag, mode = 0o666 } = {}) { if (flag === 'wx' && this.files.has(path)) throw new Error('exists'); this.files.set(path, this.entry(value, mode)); }
  async readFile(path, encoding) { const file = this.files.get(path); if (!file) throw new Error(`missing ${path}`); return encoding ? file.bytes.toString(encoding) : Buffer.from(file.bytes); }
  async readdir(path) { return [...this.files.keys(), ...this.directories.keys()].filter((key) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map((key) => key.slice(path.length + 1)); }
  async lstat(path) { const file = this.files.get(path); const value = file ?? this.directories.get(path); if (!value) { const error = new Error(`missing ${path}`); error.code = 'ENOENT'; throw error; } return this.stat(value, Boolean(file)); }
  async chmod(path, mode) { const value = this.files.get(path) ?? this.directories.get(path); if (!value) throw new Error(`missing ${path}`); value.mode = mode; }
  async unlink(path) { if (!this.files.delete(path)) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } }
  async rmdir(path) { if (!this.directories.has(path) || (await this.readdir(path)).length) throw new Error('not empty'); this.directories.delete(path); }
  async open(path, flags) { const file = this.files.get(path); const value = file ?? this.directories.get(path); if (!value) { const error = new Error(`missing ${path}`); error.code = 'ENOENT'; throw error; } this.opened.push({ flags, path }); return { chmod: async (mode) => { value.mode = mode; }, close: async () => {}, readFile: async () => Buffer.from(value.bytes), stat: async () => this.stat(value, Boolean(file)), sync: async () => { this.syncs.push(path); }, write: async (bytes, offset, length, position) => { if (!file) throw new Error('directory write'); this.writes.push({ bytes: Buffer.from(bytes).subarray(offset, offset + length), path, position }); Buffer.from(bytes).copy(value.bytes, position, offset, offset + length); return { bytesWritten: length }; } }; }
}
const rawDigest = createHash('sha256').update(raw).digest('hex');
function local() { const runner = { generation: 1, id: 7, name: policy.runner.name }; const digests = Object.fromEntries(['policyFileSha256', 'policyCanonicalSha256', 'sourceManifestSha256', 'imageSha256', 'processMapSha256', 'serviceSha256', 'scriptsSha256', 'appPermissionsSha256', 'rulesetSha256', 'runnerInventorySha256', 'hostAttestationSha256', 'liveSampleSha256', 'admissionSha256', 'holdSha256', 'restoreSha256', 'ollamaRetirementSha256', 'runnerIdentitySha256'].map((key) => [key, sha])); digests.policyFileSha256 = rawDigest; digests.runnerIdentitySha256 = createHash('sha256').update(canonical(runner)).digest('hex'); return { runner, worker: { count: 1 }, resources: Object.fromEntries(['ollamaCgroupMemoryCurrentBytesBefore', 'ollamaCgroupMemoryCurrentBytesAfter', 'hostMemAvailableBytesBefore', 'hostMemAvailableBytesAfter', 'modelStoreAllocatedBytesBefore', 'rootFreeBytesBefore', 'rootFreeBytesAfter', 'recoveredDiskBytes'].map((key) => [key, 1])), digests, failureMatrix: Object.fromEntries(['offlineRunner', 'labelUniqueness', 'hostedRunner', 'concurrentJob', 'lease', 'serviceRestart', 'reboot', 'softwareIdentity', 'egressDnsLocaleTimezone', 'cpuSet', 'thresholds', 'appPermissions', 'ruleset', 'retention', 'artifactReadback', 'rollback', 'doubleRestore', 'networkIsolation', 'supplyChain', 'retirementIdentity'].map((key) => [key, true])) }; }
function sample() { const host = { schemaVersion: 1, campaignId: 'campaign-01', captureSha256: sha, policySha256: rawDigest, generation: 1, runnerContainerId: 'b'.repeat(64), runnerIp: '172.19.0.2', runnerVeth: 'veth0', runnerPeerIfindex: 3, externalInterface: 'eth0', externalIfindex: 2, campaignMark: 12289, accountingTable: 'baci_cwv', accountingIdentitySha256: sha }; const binding = Object.fromEntries(['accountingIdentitySha256', 'accountingTable', 'campaignId', 'campaignMark', 'captureSha256', 'policySha256', 'generation', 'runnerContainerId', 'runnerIp', 'runnerVeth', 'runnerPeerIfindex', 'externalInterface', 'externalIfindex'].map((key) => [key, host[key]])); const published = buildLiveSample({ campaignId: host.campaignId, capturedAt: '2026-07-21T00:00:00.000Z', host: { ...host, liveIdentity: { classifier: { handle: 1, sha256: sha }, container: { cgroup: '/cwv-measurement.slice/docker-campaign-01.scope', expectedImage: `sha256:${sha}`, expectedNetwork: 'baci-cwv-net', id: host.runnerContainerId, image: `sha256:${sha}`, networkMode: 'baci-cwv-net', pid: 123, running: true }, idleContainerSha256: sha, nftSha256: sha } }, idle: { accepted: true, mode: 'live', campaignId: host.campaignId, binding, evidence: { container: { end: sha }, nft: { end: sha } } } }); const authorityHost = { ...published.host, nftSha256: sha, cgroupSha256: sha, dockerSha256: sha }; const idle = { ...published.idle, thresholds: policy.thresholds, load1PerCpu: 0.1, stealPercent: 0, ambientIngressBytes: 0, ambientEgressBytes: 0, measurementIngressBytes: 0, measurementEgressBytes: 0 }; return { ...published, collectors: { host: { ok: true, sha256: createHash('sha256').update(canonical(authorityHost)).digest('hex') }, idle: { ok: true, sha256: createHash('sha256').update(canonical(idle)).digest('hex') } }, host: authorityHost, idle }; }
function canonical(value) { return value && typeof value === 'object' ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value); }
function admission() { return { admissionId: 'admission-0123456789abcdef', campaignId: 'campaign-01', expectedSha: 'b'.repeat(40), expiresMonotonicSeconds: 100, kind: 'allow', policyFileSha256: rawDigest, repository: policy.repository, run: { id: 12, attempt: 1 }, runner: { generation: 1, id: 7, name: policy.runner.name }, schemaVersion: 1, workflow: { id: 1, job: 'attest', path: '.github/workflows/cwv-runner-attestation.yml', ref: 'refs/heads/main' } }; }
function env() { return { RUNNER_TEMP: temp, GITHUB_WORKSPACE: workspace, GITHUB_REPOSITORY: policy.repository.name, GITHUB_REPOSITORY_ID: '1100488586', GITHUB_WORKFLOW: 'CWV Runner Attestation', GITHUB_JOB: 'attest', GITHUB_RUN_ID: '12', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'b'.repeat(40), GITHUB_REF: 'refs/heads/main', RUNNER_NAME: policy.runner.name, RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64', BACI_CWV_ADMISSION_ID: 'admission-0123456789abcdef', BACI_CWV_HOST_EVIDENCE_DIR: '/host-evidence', BACI_CWV_POLICY_PATH: policyPath, BACI_CWV_AUDITOR_TOKEN: 'app-token', BACI_CWV_AUDITOR_INSTALLATION_ID: '42', BACI_CWV_EXPECTED_APP_SLUG: 'baci-cwv-runner-auditor', BACI_CWV_EXPECTED_INSTALLATION_ID: '42', BACI_CWV_AUDITOR_APP_SLUG: 'baci-cwv-runner-auditor', BACI_CWV_ARTIFACT_TOKEN: 'workflow-token' }; }
function stableEvidence(fs) {
  const root = '/host-evidence/stable-attestation'; const value = local(); fs.directories.set(root, fs.entry('', 0o550, 0, 0)); const files = { digests: 'digests.json', failureMatrix: 'failure-matrix.json', resources: 'resources.json', runner: 'runner.json', worker: 'worker.json' };
  const sources = {};
  for (const [name, file] of Object.entries(files)) {
    const bytes = canonical(value[name]); const sourceSha256 = createHash('sha256').update(bytes).digest('hex'); sources[name] = { file, sha256: sourceSha256 };
    fs.files.set(`${root}/${file}`, fs.entry(bytes, 0o440, 0, 0)); fs.files.set(`${root}/${file}.sha256`, fs.entry(`${sourceSha256}\n`, 0o440, 0, 0));
  }
  const accepted = Object.fromEntries(['failureMatrix', 'hold', 'hostAttestation', 'image', 'policy', 'processMap', 'resources', 'restore', 'retirement', 'scripts', 'service', 'sourceManifest'].map((key) => [key, true])); const receipt = canonical({ accepted, generation: 1, kind: 'task8-stable-attestation', policyFileSha256: rawDigest, runner: value.runner, schemaVersion: 1, sources });
  fs.files.set(`${root}/receipt.json`, fs.entry(receipt, 0o440, 0, 0)); fs.files.set(`${root}/receipt.json.sha256`, fs.entry(`${createHash('sha256').update(receipt).digest('hex')}\n`, 0o440, 0, 0));
}
function fixture() { const fs = new FakeFs({ ...checkedSources, [policyPath]: raw, '/host-evidence/live-sample.json': JSON.stringify(sample()), '/run/baci-cwv-admission/active.json': canonical(admission()) }); stableEvidence(fs); return fs; }
function api({ laterRepository = false } = {}) {
  let revoked = false; const calls = []; const prefix = `/repos/${policy.repository.name}`;
  const ruleset = { id: 3, name: policy.ruleset.name, target: 'tag', enforcement: 'active', conditions: { ref_name: { include: policy.ruleset.tagIncludes, exclude: [] } }, rules: policy.ruleset.rules.map((type) => ({ type })), bypass_actors: [] };
  const runners = Array.from({ length: 100 }, (_, id) => ({ busy: false, id: id + 100, labels: [], name: `other-${id}`, os: 'Linux', status: 'offline' }));
  const rulesets = Array.from({ length: 100 }, (_, id) => ({ id: id + 100, name: `other-${id}` })); const ok = (body) => ({ body, status: 200 });
  return { calls, async request({ method, path }) {
    calls.push(`${method} ${path}`);
    if (method === 'GET' && path === `${prefix}/actions/runners?per_page=100&page=1`) return ok({ total_count: 101, runners });
    if (method === 'GET' && path === `${prefix}/actions/runners?per_page=100&page=2`) return ok({ total_count: 101, runners: [{ id: 7, name: policy.runner.name, status: 'online', busy: true, os: 'Linux', labels: policy.runner.labels.map((name) => ({ name })) }] });
    if (method === 'GET' && path.endsWith('/actions/permissions/artifact-and-log-retention')) return ok({ days: 90, maximum_allowed_days: 90 });
    if (method === 'GET' && path === '/installation/repositories?per_page=100&page=1') { if (revoked) { const error = new Error('401'); error.status = 401; throw error; } return ok({ total_count: laterRepository ? 101 : 1, repositories: laterRepository ? Array.from({ length: 100 }, (_, id) => ({ id, full_name: `other/${id}` })) : [{ id: policy.repository.id, full_name: policy.repository.name }] }); }
    if (method === 'GET' && path === '/installation/repositories?per_page=100&page=2' && laterRepository) return ok({ total_count: 101, repositories: [{ id: policy.repository.id, full_name: policy.repository.name }] });
    if (method === 'GET' && path === `${prefix}/installation`) throw new Error('installation-token endpoint forbidden');
    if (method === 'GET' && path === `${prefix}/rulesets?per_page=100&page=1`) return ok(rulesets);
    if (method === 'GET' && path === `${prefix}/rulesets?per_page=100&page=2`) return ok([ruleset]);
    if (method === 'GET' && path === `${prefix}/rulesets/3`) return ok(ruleset);
    if (method === 'DELETE' && path === '/installation/token') { if (revoked) { const error = new Error('401'); error.status = 401; throw error; } revoked = true; return { body: null, status: 204 }; }
    if (method === 'GET' && path.endsWith('/actions/artifacts/99')) return ok({ id: 99, name: 'h0-runner-attestation-12-1', digest: `sha256:${sha}`, created_at: '2026-07-21T00:00:00.000Z', expires_at: '2026-10-19T00:00:00.000Z', expired: false, workflow_run: { id: 12 } });
    throw new Error(`unexpected ${method} ${path}`);
  } };
}
test('uses only root-mounted fresh campaign evidence and completes one exact artifact proof', async () => {
  const fs = fixture(); const environment = env(); const transport = api(); const now = () => new Date('2026-07-21T00:00:00.000Z');
  await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501, now });
  const frozenAdmission = await fs.readFile(`${scratch}/admission.json`, 'utf8');
  assert.equal(frozenAdmission, canonical(admission()));
  assert.equal(fs.opened.some(({ flags, path }) => path === '/run/baci-cwv-admission/active.json' && (flags & constants.O_NOFOLLOW) !== 0), true);
  delete environment.BACI_CWV_ADMISSION_ID;
  await runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501, now });
  const projected = JSON.parse(await fs.readFile(`${projection}/h0-runner-attestation.json`, 'utf8'));
  assert.equal(projected.digests.admissionSha256, createHash('sha256').update(frozenAdmission).digest('hex'));
  assert.equal(Object.keys(projected.digests).length, 16);
  assert.equal('runnerIdentitySha256' in projected.digests, false);
  assert.deepEqual(JSON.parse(await fs.readFile(`${scratch}/app-authority.json`, 'utf8')), { effectiveAppAuthority: { appSlug: 'baci-cwv-runner-auditor', capabilities: { artifactRetention: true, repositoryInventory: true, rulesetInventory: true, rulesetReadback: true, runnerInventory: true }, installationId: 42, repository: policy.repository, requestedPermissions: { administration: 'read', metadata: 'read' } }, tokenAuthority: { appSlug: 'baci-cwv-runner-auditor', installationId: 42, repository: policy.repository, requestedPermissions: { administration: 'read', metadata: 'read' } } });
  assert.equal(transport.calls.some((call) => call.includes('/actions/runs/')), false);
  environment.BACI_CWV_ARTIFACT_ID = '99'; environment.BACI_CWV_ARTIFACT_DIGEST = sha;
  await runAuthorityCli({ args: ['--verify-upload'], env: environment, fs, transport, uid: 501, now });
  await fs.mkdir(`${temp}/cwv-runner-readback`, { mode: 0o755 }); await fs.writeFile(`${temp}/cwv-runner-readback/h0-runner-attestation.json`, await fs.readFile(`${projection}/h0-runner-attestation.json`), { mode: 0o644 });
  await runAuthorityCli({ args: ['--verify-readback-and-clean'], env: environment, fs, transport, uid: 501, now }); assert.equal(fs.opened.some(({ flags, path }) => path.endsWith('/cwv-runner-readback/h0-runner-attestation.json') && (flags & constants.O_NOFOLLOW) !== 0), true);
  assert.equal(fs.writes.length, 6); assert.equal(fs.writes.every(({ bytes }) => bytes.every((byte) => byte === 0)), true); assert.equal(fs.syncs.includes(temp), true); for (const path of [scratch, projection, `${temp}/cwv-runner-readback`]) await assert.rejects(fs.lstat(path)); await runAuthorityCli({ args: ['--cleanup'], env: environment, fs, transport, uid: 501, now });
});
test('accepts the checked-in compact raw policy during verify-and-project', async () => { const fs = fixture(); const environment = env(); const transport = api(); const now = () => new Date('2026-07-21T00:00:00.000Z'); await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501, now }); await assert.doesNotReject(runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501, now })); });
test('does not require an unproduced local public attestation before scratch creation', async () => {
  const fs = fixture(); const environment = env(); const transport = api();
  await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501 });
  assert.equal(await fs.readFile(`${scratch}/admission.json`, 'utf8'), canonical(admission()));
  assert.deepEqual(await fs.readdir(scratch), ['admission.json']);
  assert.deepEqual(transport.calls, []);
});
test('refuses a final nested allow whose runner generation is not the initial authenticated generation', async () => {
  const fs = fixture(); const environment = env(); const value = admission(); value.runner.generation = 2;
  fs.files.get('/run/baci-cwv-admission/active.json').bytes = Buffer.from(canonical(value));
  await assert.rejects(runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport: api(), uid: 501 }), /allow binding/);
  await assert.rejects(fs.lstat(scratch));
});
test('rejects invalid local upload inputs before consuming the workflow token', async () => {
  for (const [name, mutate, error] of [
    ['missing member', async (fs) => { await fs.unlink(`${projection}/h0-runner-attestation.json`); }, /artifact members/],
    ['corrupt member', async (fs) => { await fs.writeFile(`${projection}/h0-runner-attestation.json`, 'invalid', { mode: 0o644 }); }, /invalid JSON/],
    ['mismatched projection proof', async (fs) => { await fs.writeFile(`${scratch}/projection-proof.json`, canonical({ memberSha256: sha }), { mode: 0o600 }); }, /projection proof/],
  ]) {
    const fs = fixture(); const environment = env(); const transport = api(); const now = () => new Date('2026-07-21T00:00:00.000Z');
    await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501, now });
    await runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501, now });
    environment.BACI_CWV_ARTIFACT_ID = '99'; environment.BACI_CWV_ARTIFACT_DIGEST = sha; transport.calls.length = 0;
    await mutate(fs);
    await assert.rejects(runAuthorityCli({ args: ['--verify-upload'], env: environment, fs, transport, uid: 501, now }), error, name);
    assert.equal(environment.BACI_CWV_ARTIFACT_TOKEN, 'workflow-token', name);
    assert.deepEqual(transport.calls, [], name);
  }
});

test('rejects the REST-prefixed digest where the pinned upload action emits a raw SHA-256', async () => {
  const fs = fixture(); const environment = env(); const transport = api();
  await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501 });
  environment.BACI_CWV_ARTIFACT_ID = '99'; environment.BACI_CWV_ARTIFACT_DIGEST = `sha256:${sha}`;
  await assert.rejects(runAuthorityCli({ args: ['--verify-upload'], env: environment, fs, transport, uid: 501 }), /artifact input refused/);
  assert.equal(environment.BACI_CWV_ARTIFACT_TOKEN, 'workflow-token');
});

test('wipes and removes the workflow token when the artifact receipt request fails', async () => {
  const fs = fixture(); const environment = env(); const base = api(); const now = () => new Date('2026-07-21T00:00:00.000Z');
  await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport: base, uid: 501, now });
  await runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport: base, uid: 501, now });
  environment.BACI_CWV_ARTIFACT_ID = '99'; environment.BACI_CWV_ARTIFACT_DIGEST = sha; let token;
  const transport = { calls: base.calls, async request(input) { if (input.path.endsWith('/actions/artifacts/99')) { token = input.token; assert.equal(environment.BACI_CWV_ARTIFACT_TOKEN, undefined); throw new Error('artifact request failed'); } return base.request(input); } };
  await assert.rejects(runAuthorityCli({ args: ['--verify-upload'], env: environment, fs, transport, uid: 501, now }), /artifact request failed/);
  assert.equal(token.every((byte) => byte === 0), true);
  assert.equal('BACI_CWV_ARTIFACT_TOKEN' in environment, false);
});

test('never recursively resets private state and fails closed on unexpected, linked, or drifting cleanup targets', async () => {
  const fs = fixture(); const environment = env(); await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport: api(), uid: 501 });
  const frozen = await fs.readFile(`${scratch}/admission.json`, 'utf8'); await assert.rejects(runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport: api(), uid: 501 }), /exists/); assert.equal(await fs.readFile(`${scratch}/admission.json`, 'utf8'), frozen);
  await fs.writeFile(`${scratch}/unexpected`, 'x', { mode: 0o600 }); await assert.rejects(runAuthorityCli({ args: ['--cleanup'], env: environment, fs, transport: api(), uid: 501 }), /private scratch refused/); assert.equal(fs.writes.length, 0);
  await fs.unlink(`${scratch}/unexpected`); fs.files.get(`${scratch}/admission.json`).symlink = true; await assert.rejects(runAuthorityCli({ args: ['--cleanup'], env: environment, fs, transport: api(), uid: 501 }), /private scratch refused/);
  const drift = fixture(); const driftEnv = env(); await runAuthorityCli({ args: ['--prepare-scratch'], env: driftEnv, fs: drift, transport: api(), uid: 501 }); const open = drift.open.bind(drift);
  drift.open = async (path, flags) => { const handle = await open(path, flags); return path.endsWith('/admission.json') ? { ...handle, stat: async () => ({ ...(await handle.stat()), ino: 99 }) } : handle; };
  await assert.rejects(runAuthorityCli({ args: ['--cleanup'], env: driftEnv, fs: drift, transport: api(), uid: 501 }), /private scratch refused/);
});

test('refuses to wipe a scratch directory with unsafe ownership, mode, link, or identity', async () => {
  for (const mutate of [
    (entry) => { entry.uid = 502; },
    (entry) => { entry.mode = 0o755; },
    (entry) => { entry.symlink = true; },
  ]) {
    const fs = fixture(); const environment = env();
    await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport: api(), uid: 501 });
    mutate(fs.directories.get(scratch));
    await assert.rejects(runAuthorityCli({ args: ['--cleanup'], env: environment, fs, transport: api(), uid: 501 }), /private scratch unavailable/);
  }
  const fs = fixture(); const environment = env();
  await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport: api(), uid: 501 });
  const open = fs.open.bind(fs);
  fs.open = async (path, flags) => {
    const handle = await open(path, flags);
    if (path !== scratch) return handle;
    return { ...handle, stat: async () => ({ ...(await handle.stat()), ino: 99 }) };
  };
  await assert.rejects(runAuthorityCli({ args: ['--cleanup'], env: environment, fs, transport: api(), uid: 501 }), /private scratch unavailable/);
});

test('rejects stale evidence only after authority completion and revocation', async () => {
  const fs = fixture(); const environment = env(); const transport = api(); await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501 });
  await assert.rejects(runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501, now: () => new Date('2026-07-21T00:00:16.000Z') }), /live sample/);
  assert.deepEqual(transport.calls.slice(-2), ['DELETE /installation/token', 'GET /installation/repositories?per_page=100&page=1']);
  await assert.rejects(fs.lstat(projection));
});
test('rejects a buildLiveSample container identity that no longer binds its runner', async () => { const fs = fixture(); const environment = env(); const transport = api(); await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501 }); const live = JSON.parse(await fs.readFile('/host-evidence/live-sample.json', 'utf8')); live.host.liveIdentity.container.id = sha; live.collectors.host.sha256 = createHash('sha256').update(canonical(live.host)).digest('hex'); fs.files.get('/host-evidence/live-sample.json').bytes = Buffer.from(JSON.stringify(live)); await assert.rejects(runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501, now: () => new Date('2026-07-21T00:00:00.000Z') }), /live identity refused/); assert.deepEqual(transport.calls.slice(-2), ['DELETE /installation/token', 'GET /installation/repositories?per_page=100&page=1']); });

test('authenticates sealed evidence before GitHub reads and revokes before live evidence', async () => {
  const fs = fixture(); const environment = env(); const base = api(); let revoked = false; let tokenBuffer; const read = fs.readFile.bind(fs); const open = fs.open.bind(fs);
  fs.readFile = async (path, ...args) => { if (path === '/host-evidence/live-sample.json') assert.equal(revoked, true); return read(path, ...args); };
  fs.open = async (path, ...args) => { if (path.startsWith('/host-evidence/stable-attestation')) assert.equal(revoked, false); return open(path, ...args); };
  const transport = {
    calls: base.calls,
    async request(input) {
      assert.equal(Buffer.isBuffer(input.token), true);
      assert.equal(environment.BACI_CWV_AUDITOR_TOKEN, undefined);
      tokenBuffer ??= input.token;
      try { return await base.request(input); } catch (error) { if (input.path === '/installation/repositories?per_page=100&page=1' && error?.status === 401) revoked = true; throw error; }
    },
  };
  await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501 });
  await runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501, now: () => new Date('2026-07-21T00:00:00.000Z') });
  assert.equal(environment.BACI_CWV_AUDITOR_TOKEN, undefined);
  assert.equal(tokenBuffer.every((byte) => byte === 0), true);
  assert.deepEqual(base.calls.slice(-2), ['DELETE /installation/token', 'GET /installation/repositories?per_page=100&page=1']);
});

test('fails closed after revocation when authenticated stable host receipts are absent', async () => {
  const fs = fixture(); const environment = env(); const transport = api();
  await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501 });
  for (const key of [...fs.files.keys(), ...fs.directories.keys()]) if (key.startsWith('/host-evidence/stable-attestation')) { fs.files.delete(key); fs.directories.delete(key); }
  await assert.rejects(runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501, now: () => new Date('2026-07-21T00:00:00.000Z') }), /authenticated root evidence/);
  assert.deepEqual(transport.calls.slice(-2), ['DELETE /installation/token', 'GET /installation/repositories?per_page=100&page=1']);
  await assert.rejects(fs.lstat(projection));
});

test('revokes and wipes every minted App token even when post-mint bindings are malformed', async () => {
  for (const mutate of [
    (environment) => { environment.BACI_CWV_AUDITOR_INSTALLATION_ID = '41'; },
    (environment) => { environment.BACI_CWV_AUDITOR_APP_SLUG = 'wrong-app'; },
    (environment) => { environment.BACI_CWV_HOST_EVIDENCE_DIR = '/wrong'; },
    (environment) => { environment.BACI_CWV_POLICY_PATH = '/wrong'; },
  ]) {
    const fs = fixture(); const environment = env(); const base = api(); let token; await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport: base, uid: 501 }); mutate(environment);
    const transport = { calls: base.calls, async request(input) { token ??= input.token; return base.request(input); } };
    await assert.rejects(runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501 }), /App token binding/);
    assert.deepEqual(base.calls, ['DELETE /installation/token', 'GET /installation/repositories?per_page=100&page=1']); assert.equal(token.every((byte) => byte === 0), true); assert.equal('BACI_CWV_AUDITOR_TOKEN' in environment, false);
  }
});

test('revokes and wipes the minted App token before projection can fail', async () => {
  const fs = fixture(); const environment = env(); const base = api(); let token; await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport: base, uid: 501 }); const write = fs.writeFile.bind(fs);
  fs.writeFile = async (path, ...args) => { if (path === `${projection}/h0-runner-attestation.json`) { assert.deepEqual(base.calls.slice(-2), ['DELETE /installation/token', 'GET /installation/repositories?per_page=100&page=1']); assert.equal(token.every((byte) => byte === 0), true); throw new Error('projection write refused'); } return write(path, ...args); };
  const transport = { calls: base.calls, async request(input) { token ??= input.token; return base.request(input); } };
  await assert.rejects(runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501, now: () => new Date('2026-07-21T00:00:00.000Z') }), /projection write refused/);
  assert.deepEqual(base.calls.slice(-2), ['DELETE /installation/token', 'GET /installation/repositories?per_page=100&page=1']); assert.equal(token.every((byte) => byte === 0), true);
});

test('revokes and wipes minted tokens before rejecting invalid context or unavailable scratch', async () => {
  for (const mutate of [
    (environment) => { environment.GITHUB_SHA = 'bad'; },
    (_environment, fs) => { fs.directories.delete(scratch); },
    (_environment, fs) => { fs.directories.get(scratch).mode = 0o755; },
  ]) {
    const fs = fixture(); const environment = env(); const base = api(); let token; await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport: base, uid: 501 }); mutate(environment, fs);
    const transport = { calls: base.calls, async request(input) { token ??= input.token; return base.request(input); } };
    await assert.rejects(runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501 }), /invalid GitHub context|private scratch unavailable/);
    assert.deepEqual(base.calls, ['DELETE /installation/token', 'GET /installation/repositories?per_page=100&page=1']); assert.equal(token.every((byte) => byte === 0), true); assert.equal('BACI_CWV_AUDITOR_TOKEN' in environment, false);
  }
});

test('rejects malformed invocation before reading or consuming an App token', async () => {
  const environment = env(); const transport = api(); await assert.rejects(runAuthorityCli({ args: ['--invalid'], env: environment, fs: fixture(), transport, uid: 501 }), /expected one authority mode/); assert.equal(environment.BACI_CWV_AUDITOR_TOKEN, 'app-token'); assert.deepEqual(transport.calls, []);
});

test('requires an exact 204 revocation response before the 401 proof', async () => {
  const fs = fixture(); const environment = env(); const base = api();
  const transport = { async request(input) { if (input.method === 'DELETE') return { body: {}, status: 200 }; return base.request(input); } };
  await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501 });
  await assert.rejects(runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501, now: () => new Date('2026-07-21T00:00:00.000Z') }), /204/);
});

test('rejects a page-later installation repository before revocation without an installation endpoint', async () => {
  const fs = fixture(); const environment = env(); const transport = api({ laterRepository: true });
  await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501 });
  await assert.rejects(runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501, now: () => new Date('2026-07-21T00:00:00.000Z') }), /App authority/);
  assert.ok(transport.calls.indexOf('GET /installation/repositories?per_page=100&page=2') < transport.calls.indexOf('DELETE /installation/token'));
  assert.equal(transport.calls.some((call) => call === `GET /repos/${policy.repository.name}/installation`), false);
});

test('rejects broader pinned App workflow permission inputs before GitHub capability reads', async () => {
  const fs = fixture(); const environment = env(); const transport = api();
  await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501 });
  fs.files.get(`${workspace}/.github/workflows/cwv-runner-attestation.yml`).bytes = Buffer.from(readFileSync(new URL('.github/workflows/cwv-runner-attestation.yml', root), 'utf8').replace('permission-metadata: read', 'permission-metadata: write'));
  await assert.rejects(runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501, now: () => new Date('2026-07-21T00:00:00.000Z') }), /workflow step graph/);
  assert.deepEqual(transport.calls, ['DELETE /installation/token', 'GET /installation/repositories?per_page=100&page=1']);
});

test('refuses checked-out workflow drift before projecting an attestation', async () => {
  const fs = fixture(); const environment = env(); const transport = api();
  await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501 });
  fs.files.get(`${workspace}/.github/workflows/cwv-runner-attestation.yml`).bytes = Buffer.from(readFileSync(new URL('.github/workflows/cwv-runner-attestation.yml', root), 'utf8').replace('retention-days: 90', 'retention-days: 1'));
  await assert.rejects(runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501 }), /workflow step graph/);
  await assert.rejects(fs.lstat(projection));
});

test('refuses a newline-appended mounted admission receipt', async () => {
  const fs = fixture(); const environment = env();
  fs.files.get('/run/baci-cwv-admission/active.json').bytes = Buffer.from(`${canonical(admission())}\n`);
  await assert.rejects(runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport: api(), uid: 501 }), /invalid admission record/);
});

test('refuses a mounted admission receipt replaced after opening', async () => {
  const fs = fixture(); const environment = env(); const open = fs.open.bind(fs);
  fs.open = async (path, flags) => {
    const handle = await open(path, flags);
    if (path === '/run/baci-cwv-admission/active.json') await fs.writeFile(path, canonical(admission()), { mode: 0o644 });
    return handle;
  };
  await assert.rejects(runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport: api(), uid: 501 }), /invalid admission record/);
});
test('authenticates sealed local authority before any remote authority reads', async () => { const fs = fixture(); const environment = env(); const transport = api(); await runAuthorityCli({ args: ['--prepare-scratch'], env: environment, fs, transport, uid: 501 }); fs.files.get('/host-evidence/stable-attestation/worker.json').bytes = Buffer.from(canonical({ count: 2 })); await assert.rejects(runAuthorityCli({ args: ['--verify-and-project'], env: environment, fs, transport, uid: 501 }), /worker source sidecar/); assert.deepEqual(transport.calls, ['DELETE /installation/token', 'GET /installation/repositories?per_page=100&page=1']); });
test('top-level dispatcher executes instead of succeeding as a no-op', () => {
  const authority = fileURLToPath(new URL('./cwv-runner-authority.mjs', import.meta.url)); const result = spawnSync(process.execPath, [authority, '--prepare-scratch'], { env: {} }); assert.equal(result.status, 1); assert.match(result.stderr.toString(), /missing RUNNER_TEMP/);
});

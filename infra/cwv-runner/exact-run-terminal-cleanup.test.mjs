// biome-ignore-all format: compact lifecycle fixtures stay within the source ceiling.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const run = (value, args = [value.campaign]) =>
  spawnSync('/bin/sh', [value.script, ...args], { encoding: 'utf8' });

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cwv-exact-terminal-'));
  t.after(() => fs.rm(root, { force: true, recursive: true }));
  const names = [
    'allow',
    'campaigns',
    'control',
    'inventory',
    'listener',
    'run',
  ];
  const paths = Object.fromEntries(
    names.map((name) => [name, path.join(root, name)])
  );
  const cgroup = path.join(root, 'cgroup');
  const fixed = path.join(root, 'fixed');
  await Promise.all(
    [...Object.values(paths), cgroup, fixed].map((file) =>
      fs.mkdir(file, { recursive: true })
    )
  );
  const campaign = 'campaign';
  const control = path.join(paths.control, campaign);
  const state = path.join(paths.campaigns, campaign);
  const runnerId = 'b'.repeat(64);
  const correctScope = `/cwv-measurement.slice/docker-${runnerId}.scope`;
  const identityScope = options.wrongIdentity
    ? '/cwv-measurement.slice/docker-c.scope'
    : correctScope;
  const servicePath = path.join(
    cgroup,
    'cwv-measurement-control.slice',
    'baci-cwv-measurement.service'
  );
  const scopePath = path.join(cgroup, correctScope);
  await Promise.all([fs.mkdir(control), fs.mkdir(state)]);
  if (!options.absentServiceCgroup) {
    await fs.mkdir(servicePath, { recursive: true });
    await fs.writeFile(
      path.join(servicePath, 'cgroup.procs'),
      options.serviceProcesses ?? ''
    );
  }
  if (options.siblingScope) {
    const sibling = path.join(
      cgroup,
      'cwv-measurement.slice',
      `docker-${'c'.repeat(64)}.scope`
    );
    await fs.mkdir(sibling, { recursive: true });
    await fs.writeFile(
      path.join(sibling, 'cgroup.procs'),
      options.siblingProcesses ?? ''
    );
  }
  const environment = path.join(root, 'measurement.env');
  const artifacts = {
    allow: path.join(paths.allow, 'active.json'),
    environment,
    inventory: path.join(paths.inventory, 'active.json'),
    release: path.join(paths.listener, 'release.json'),
    samplerEnvironment: path.join(paths.run, 'host-sampler.env'),
  };
  if (!options.nullArtifacts)
    for (const [key, file] of Object.entries(artifacts)) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `${key}\n`);
    }
  const captureSha = 'a'.repeat(64);
  const binding = '{"admissionId":"admission"}';
  await Promise.all([
    fs.writeFile(path.join(state, 'capture.sha256'), captureSha),
    fs.writeFile(path.join(control, 'binding.json'), binding),
  ]);
  const active = {
    artifacts: Object.fromEntries(
      await Promise.all(
        Object.entries(artifacts).map(async ([key, file]) => [
          key,
          options.nullArtifacts ? null : sha256(await fs.readFile(file)),
        ])
      )
    ),
    campaignId: campaign,
    captureSha256: captureSha,
    controllerBindingSha256: sha256(binding),
    generation: 1,
    schemaVersion: 1,
  };
  await fs.writeFile(
    path.join(control, 'active-transaction.json'),
    JSON.stringify(active)
  );
  if (!options.noIdentity)
    await fs.writeFile(
      path.join(control, 'process-identity.json'),
      JSON.stringify({
        cgroupPath: identityScope,
        cpuset: '2-3',
        generation: 1,
        processMapSha256: 'd'.repeat(64),
        runnerContainerId: runnerId,
      })
    );
  const dockerState = path.join(root, 'container-present');
  const fixedNameState = path.join(root, 'fixed-name-present');
  const labelState = path.join(root, 'label-present');
  if (!options.absentContainer) {
    await fs.writeFile(dockerState, 'present');
    await fs.writeFile(fixedNameState, 'present');
    await fs.writeFile(labelState, 'present');
    await fs.mkdir(scopePath, { recursive: true });
    await fs.writeFile(path.join(scopePath, 'cgroup.procs'), '42\n');
  }
  if (options.fixedNamePresent) await fs.writeFile(fixedNameState, 'present');
  if (options.labelPresent) await fs.writeFile(labelState, 'present');
  const log = path.join(root, 'calls.log');
  const socket = path.join(root, 'docker.sock');
  if (!options.noSocket) await fs.writeFile(socket, 'test socket');
  const systemctl = path.join(fixed, 'systemctl');
  const stat = path.join(fixed, 'stat');
  const sync = path.join(fixed, 'sync');
  const move = path.join(fixed, 'mv');
  const docker = path.join(fixed, 'docker');
  const group = options.emptyControlGroup
    ? ''
    : '/cwv-measurement-control.slice/baci-cwv-measurement.service';
  await fs.writeFile(
    systemctl,
    `#!/bin/sh\nprintf '%s\\n' "$*" >>'${log}'\ncase "$*" in *ActiveState*) printf inactive ;; *SubState*) printf dead ;; *MainPID*) printf 0 ;; *ControlGroup*) printf '${group}' ;; esac\n`
  );
  await fs.writeFile(stat, '#!/bin/sh\nprintf 0:600');
  await fs.writeFile(sync, '#!/bin/sh\n:');
  await fs.writeFile(
    move,
    '#!/bin/sh\n[ "$1" = -T ] && shift\nexec /bin/mv "$@"'
  );
  await fs.writeFile(
    docker,
    `#!/bin/sh\nprintf '%s\\n' "$*" >>'${log}'\ncase "$*" in *'container inspect baci-cwv-measurement'*) [ -e '${fixedNameState}' ] || { printf 'Error response from daemon: No such container: baci-cwv-measurement' >&2; exit 1; }; printf '[{"Id":"measurement"}]\\n' ;; *'ps -aq --no-trunc --filter label=baci.cwv.transaction'*) [ ! -e '${labelState}' ] || printf '${runnerId}\\n' ;; *inspect*) [ -e '${dockerState}' ] || { printf 'Error response from daemon: No such container: ${runnerId}' >&2; exit 1; }; printf '%s\\n' '[{"Config":{"Labels":{"baci.cwv.transaction":"${campaign}"}},"HostConfig":{"CgroupParent":"cwv-measurement.slice"},"Id":"${runnerId}"}]' ;; *stop*) : ;; *rm*) rm -f '${dockerState}' '${fixedNameState}' '${labelState}'; rm -rf '${scopePath}' ;; esac\n`
  );
  await Promise.all(
    [systemctl, stat, sync, move, docker].map((file) => fs.chmod(file, 0o755))
  );
  const source = await fs.readFile(
    new URL('./exact-run-terminal-cleanup.sh', import.meta.url),
    'utf8'
  );
  const script = path.join(root, 'cleanup.sh');
  await fs.writeFile(
    script,
    source
      .replaceAll('/srv/baci-cwv/campaigns', paths.campaigns)
      .replaceAll('/srv/baci-cwv/exact-runs', paths.control)
      .replaceAll('/srv/baci-cwv/allow', paths.allow)
      .replaceAll('/srv/baci-cwv/inventory', paths.inventory)
      .replaceAll('/srv/baci-cwv/listener-release', paths.listener)
      .replaceAll('/etc/baci-cwv/measurement.env', environment)
      .replaceAll(
        '/run/baci-cwv/host-sampler.env',
        artifacts.samplerEnvironment
      )
      .replaceAll('/run/baci-cwv/docker/docker.sock', socket)
      .replaceAll('/run/baci-cwv/docker.sock', socket)
      .replaceAll(
        '[ -S "${DOCKER_SOCKET#unix://}" ]',
        '[ -e "${DOCKER_SOCKET#unix://}" ]'
      )
      .replaceAll('/bin/systemctl', systemctl)
      .replaceAll('/usr/bin/docker', docker)
      .replaceAll('/usr/bin/stat', stat)
      .replaceAll('/usr/bin/sha256sum', '/usr/bin/shasum -a 256')
      .replaceAll('/usr/bin/sync', sync)
      .replaceAll('/bin/mv -T', move)
      .replaceAll('/sys/fs/cgroup', cgroup)
  );
  await fs.chmod(script, 0o755);
  return { active, artifacts, campaign, control, log, script };
}

test('removes receipt-bound artifacts only after stopping and removing the exact runner', async (t) => {
  const value = await fixture(t);
  const result = run(value);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  for (const file of Object.values(value.artifacts))
    await assert.rejects(fs.access(file));
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(value.control, 'active-transaction.json'),
        'utf8'
      )
    ).artifacts,
    Object.fromEntries(
      Object.keys(value.active.artifacts).map((key) => [key, null])
    )
  );
  assert.match(
    await fs.readFile(value.log, 'utf8'),
    /stop baci-cwv-measurement\.service[\s\S]*stop.*b{64}[\s\S]*rm -f.*b{64}/
  );
});

test('accepts an empty service ControlGroup when the expected control cgroup is absent and the exact container is already absent', async (t) => {
  const value = await fixture(t, {
    absentContainer: true,
    absentServiceCgroup: true,
    emptyControlGroup: true,
  });
  assert.equal(run(value).status, 0);
});

test('observes a terminal transaction without changing any cleanup state', async (t) => {
  const value = await fixture(t, { absentContainer: true });
  const before = await fs.readFile(path.join(value.control, 'active-transaction.json'), 'utf8');
  const result = run(value, ['--observe-terminal', value.campaign]);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, '{"busy":false,"phase":"terminal","processes":[]}\n');
  assert.equal(await fs.readFile(path.join(value.control, 'active-transaction.json'), 'utf8'), before);
  for (const file of Object.values(value.artifacts)) await assert.doesNotReject(fs.access(file));
  assert.doesNotMatch(await fs.readFile(value.log, 'utf8'), /\b(?:stop|rm)\b/);
});
// biome-ignore format: compact failure matrix preserves the 300-line contract
for (const [name, options] of [
  [
    'a surviving sibling measurement scope',
    { absentContainer: true, siblingScope: true },
  ],
  ['a wrong cgroup and runner-container binding', { wrongIdentity: true }],
  [
    'missing process identity while artifacts remain bound',
    { noIdentity: true },
  ],
])
  test(`fails closed for ${name}`, async (t) => {
    const value = await fixture(t, options);
    assert.notEqual(run(value).status, 0);
    for (const file of Object.values(value.artifacts))
      await assert.doesNotReject(fs.access(file));
  });

test('permits a pre-container early cleanup when all artifacts are already null', async (t) => {
  const value = await fixture(t, {
    noIdentity: true,
    nullArtifacts: true,
    absentContainer: true,
  });
  assert.equal(run(value).status, 0);
});

test('recovers a controller crash after service start but before process identity publication', async (t) => {
  const value = await fixture(t, { absentContainer: true, noIdentity: true });
  const result = run(value);
  assert.equal(result.status, 0, result.stderr);
  for (const file of Object.values(value.artifacts))
    await assert.rejects(fs.access(file));
});
// biome-ignore format: compact failure matrix preserves the 300-line contract
for (const [name, options] of [
  ['the dedicated socket is missing', { noIdentity: true, absentContainer: true, noSocket: true }],
  ['the fixed measurement container survives', { noIdentity: true, absentContainer: true, fixedNamePresent: true }],
  ['a transaction-labeled container survives', { noIdentity: true, absentContainer: true, labelPresent: true }],
  ['a measurement scope still has processes', { noIdentity: true, absentContainer: true, siblingScope: true, siblingProcesses: '7\n' }],
])
  test(`fails closed before process identity publication when ${name}`, async (t) => {
    const value = await fixture(t, options);
    assert.notEqual(run(value).status, 0);
    for (const file of Object.values(value.artifacts))
      await assert.doesNotReject(fs.access(file));
  });

test('requires the dedicated Docker socket when process identity exists', async (t) => {
  const value = await fixture(t, { absentContainer: true, noSocket: true });
  assert.notEqual(run(value).status, 0);
});

test('uses only the flat dedicated Docker socket', async () => {
  const source = await fs.readFile(
    new URL('./exact-run-terminal-cleanup.sh', import.meta.url),
    'utf8'
  );
  assert.match(source, /DOCKER_SOCKET=unix:\/\/\/run\/baci-cwv\/docker\.sock/);
  assert.match(source, /\[ -S "\$\{DOCKER_SOCKET#unix:\/\/\}" \]/);
  assert.doesNotMatch(source, /\/run\/baci-cwv\/docker\/docker\.sock/);
});

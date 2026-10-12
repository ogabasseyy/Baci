import assert from 'node:assert/strict';
import test from 'node:test';
import { hostedSavingsInstallContract } from './hosted-savings-install-contract';
import { createHostedSavingsDocker } from './hosted-savings-install-docker';

const receipt = hostedSavingsInstallContract.parse({
  version: 1,
  project: 'baci-isolated-savings',
  service: 'postgres',
  containerId: 'a'.repeat(64),
  imageId: `sha256:${'b'.repeat(64)}`,
  dockerSocket: '/var/run/docker.sock',
  postgresSocket: '/tmp',
  database: 'postgres',
  serverVersion: 170006,
  manifestSha256: 'c'.repeat(64),
  parentReviewed: true,
  maintenance: true,
  noApplicationActivity: true,
  noExternalCredentials: true,
});
function objects() {
  return {
    container: {
      id: receipt.containerId,
      image: receipt.imageId,
      labels: {
        'com.docker.compose.project': receipt.project,
        'com.docker.compose.service': receipt.service,
      },
      running: true,
      paused: false,
      privileged: false,
      caps: [],
      ports: {},
      networks: { private: {} },
      mounts: [],
    },
    network: {
      internal: true,
      labels: { 'com.docker.compose.project': receipt.project },
      containers: { [receipt.containerId]: {} },
    },
  };
}

test('verifies receipt identity/internal network and pins psql to a socket with sanitized environment', async () => {
  const state = objects();
  const transport = async (args: string[], input?: string) => {
    if (args[0] === 'exec') {
      assert.deepEqual(args.slice(0, 5), [
        'exec',
        '-i',
        receipt.containerId,
        'env',
        '-i',
      ]);
      assert.ok(args.includes('ON_ERROR_STOP=1'));
      assert.deepEqual(args.slice(-2), ['-f', '-']);
      assert.ok(args.includes('/tmp'));
      assert.equal(input, 'SELECT 1;');
      return '1';
    }
    return JSON.stringify(
      args[0] === 'network' ? state.network : state.container
    );
  };
  const runtime = createHostedSavingsDocker(receipt, transport);
  await runtime.verify();
  assert.equal(await runtime.sql('SELECT 1;'), '1');
});

test('rejects identity drift, published ports, privilege and external network before SQL', async () => {
  for (const kind of ['identity', 'ports', 'privilege', 'external']) {
    const state = objects();
    if (kind === 'identity') state.container.id = 'f'.repeat(64);
    if (kind === 'ports')
      Object.assign(state.container.ports, { '5432/tcp': [] });
    if (kind === 'privilege') state.container.privileged = true;
    if (kind === 'external') state.network.internal = false;
    const runtime = createHostedSavingsDocker(receipt, async (args) => {
      assert.notEqual(args[0], 'exec');
      return JSON.stringify(
        args[0] === 'network' ? state.network : state.container
      );
    });
    await assert.rejects(runtime.verify());
  }
});

test('rejects an active application peer', async () => {
  const state = objects();
  Object.assign(state.network.containers, { ['d'.repeat(64)]: {} });
  const runtime = createHostedSavingsDocker(receipt, async (args) =>
    JSON.stringify(
      args[0] === 'network'
        ? state.network
        : args[1] === receipt.containerId
          ? state.container
          : { running: true, paused: false }
    )
  );
  await assert.rejects(runtime.verify(), /Application peer/);
});

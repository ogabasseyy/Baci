import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runHostedDraftActivation } from './managed-hosted-draft-activation-runner.mjs';

const identity = JSON.parse(
  await readFile(new URL('./managed-hosted-draft-identity.json', import.meta.url))
);

function fixture() {
  let elapsed = 0;
  let started = false;
  const calls = [];
  const reports = [];
  const actions = {
    now: () => 1_800_000_000_000 + elapsed,
    monotonic: () => elapsed,
    pause: async (duration) => {
      elapsed += duration;
    },
    modules: async () => ({
      validateRoutingIdentityShape: () => {},
      validateRoutingIdentity: () => {},
      validateManagedStartup: (binding) =>
        assert.equal(
          Date.parse(binding.leaseExpiresAt) - Date.parse(binding.leaseNotBefore),
          86_400_000
        ),
      managedInventory: async () => ({
        observedAt: new Date(actions.now()).toISOString(),
      }),
    }),
    state: async () => ({
      LoadState: 'loaded',
      ActiveState: started ? 'active' : 'inactive',
      MainPID: started ? '123' : '0',
      Restart: 'no', NRestarts: '0',
      FragmentPath: '/etc/systemd/system/baci-savings-gateway.service',
      DropInPaths: '', NeedDaemonReload: 'no', UnitFileState: 'static',
      InvocationID: started ? 'a'.repeat(32) : '',
    }),
    absent: async (path) => !path.endsWith('ingress.sock') || !started,
    noProcesses: async () => {},
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (command === '/usr/bin/sudo' && args.length > 6)
        throw Object.assign(new Error('denied'), { code: 1 });
      if (args[0] === 'start') started = true;
      if (args[0] === 'stop') started = false;
      return '';
    },
    get: async (options) => {
      if (options.path === '/auth/v1/user') return 401;
      if (options.path === '/auth/v1/admin/users') return 403;
      return 200;
    },
    create: async (name, value, gid, owned) => owned.push({ name, value, gid }),
    remove: async (record) => calls.push(['remove', record.name]),
    socket: async () => {},
    noNewPrivs: async () => 0,
    report: (value) => reports.push(value),
  };
  return { actions, calls, reports };
}

test('retains the exact hosted-draft identity for a 24-hour activation', async () => {
  const { actions, calls, reports } = fixture();
  let activated = false;
  await runHostedDraftActivation({ identity, uid: 100, gid: 101 }, actions, async () => {
    activated = true;
  });
  assert.equal(activated, true);
  assert.ok(reports.some((report) => report.leaseSeconds === 86400));
  assert.ok(reports.some((report) => report.stage === 'retained-activation'));
  assert.ok(!calls.some((call) => call[1] === 'stop' || call[0] === 'remove'));
});

test('rejects a tampered hosted route before any host mutation', async () => {
  const { actions, calls } = fixture();
  const altered = structuredClone(identity);
  altered.restRoutes[3].methods = ['GET'];
  await assert.rejects(
    runHostedDraftActivation({ identity: altered, uid: 100, gid: 101 }, actions, async () => {})
  );
  assert.equal(calls.length, 0);
});

test('rolls back retained evidence when activation callback fails', async () => {
  const { actions, calls } = fixture();
  await assert.rejects(
    runHostedDraftActivation({ identity, uid: 100, gid: 101 }, actions, async () => {
      throw new Error('activation failed');
    })
  );
  assert.ok(calls.some((call) => call[1] === 'stop'));
  assert.deepEqual(calls.filter((call) => call[0] === 'remove').map((call) => call[1]), [
    'startup-evidence',
    'binding',
  ]);
});

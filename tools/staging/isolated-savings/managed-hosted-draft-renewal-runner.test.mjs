import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runHostedDraftRenewal } from './managed-hosted-draft-renewal-runner.mjs';

const identity = JSON.parse(
  await readFile(
    new URL('./managed-hosted-draft-identity.json', import.meta.url)
  )
);

test('renews the exact hosted-draft route identity for seven days', async () => {
  let started = false;
  const actions = {
    now: () => 1_800_000_000_000,
    monotonic: () => 0,
    modules: async () => ({ validateRoutingIdentityShape: () => {} }),
    state: async () => ({ ActiveState: started ? 'active' : 'inactive', MainPID: started ? '123' : '0', LoadState: 'loaded', Restart: 'no', NRestarts: '0', FragmentPath: '/etc/systemd/system/baci-savings-gateway.service', DropInPaths: '', NeedDaemonReload: 'no', UnitFileState: 'static', InvocationID: started ? 'a'.repeat(32) : '' }),
    absent: async (path) => !path.endsWith('ingress.sock') || !started,
    noProcesses: async () => {},
    run: async (command, args) => {
      if (command === '/usr/bin/sudo' && args.length > 6)
        throw Object.assign(new Error('denied'), { code: 1 });
      if (args[0] === 'start') started = true;
      return '';
    },
    get: async ({ path }) => {
      if (path === '/auth/v1/user') return 401;
      if (path === '/auth/v1/admin/users') return 403;
      return 200;
    },
    create: async (name, value, group, owned) => owned.push({ name, value, group }),
    remove: async () => {}, socket: async () => {}, noNewPrivs: async () => 0,
    report: () => {}, pause: async () => {},
  };
  actions.modules = async () => ({
    validateRoutingIdentityShape: () => {},
    validateRoutingIdentity: () => {},
    validateManagedStartup: (binding) => assert.equal(
      Date.parse(binding.leaseExpiresAt) - Date.parse(binding.leaseNotBefore),
      604800000
    ),
    managedInventory: async () => ({ observedAt: new Date(actions.now()).toISOString() }),
  });
  await runHostedDraftRenewal({ identity, uid: 100, gid: 101 }, actions);
});

test('rejects a changed hosted-draft route before host actions', async () => {
  const altered = structuredClone(identity);
  altered.restRoutes[3].methods = ['GET'];
  await assert.rejects(runHostedDraftRenewal({ identity: altered }, {}));
});

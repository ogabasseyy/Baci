import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runPrivateSmoke } from './managed-private-smoke-runner.mjs';
import { fundingRouteContract } from './managed-funding-route-contract.mjs';

const identity = JSON.parse(await readFile(new URL('./managed-private-smoke-identity.json', import.meta.url)));

test('funding contract retains the exact absolute lease expiry', async () => {
  const { actions, files } = fixture('', 120000);
  const expiresAt = new Date(actions.now() + 120000).toISOString();
  await runPrivateSmoke(
    { identity: { ...identity, restRoutes: fundingRouteContract() }, uid: 100, gid: 101 },
    actions,
    async () => {},
    { retainOnReady: true, routeContract: 'hosted-funding', leaseExpiresAt: expiresAt }
  );
  assert.equal(files.find(({ name }) => name === 'binding').value.leaseExpiresAt, expiresAt);
});

test('funding refuses missing expiry and privileged routes before host actions', async () => {
  for (const routes of [fundingRouteContract(), [...fundingRouteContract(), { path: '/rest/v1/rpc/prepare_provisioning_intent', methods: ['POST'] }]]) {
    const { actions, calls } = fixture();
    await assert.rejects(runPrivateSmoke(
      { identity: { ...identity, restRoutes: routes }, uid: 100, gid: 101 }, actions,
      async () => {}, { retainOnReady: true, routeContract: 'hosted-funding' }
    ));
    assert.equal(calls.length, 0);
  }
});
function fixture(fail = '', leaseMs = 60000) {
  let elapsed = 0;
  let started = false;
  const calls = [];
  const files = [];
  const reports = [];
  const actions = {
    now: () => 1800000000000 + elapsed, monotonic: () => elapsed,
    pause: async (duration) => { elapsed += duration; },
    modules: async () => ({
      validateRoutingIdentityShape: () => {}, validateRoutingIdentity: () => {},
      validateManagedStartup: (binding, evidence, now) => {
        assert.equal(Date.parse(binding.leaseExpiresAt) - Date.parse(binding.leaseNotBefore), leaseMs);
        assert.equal(Date.parse(evidence.receipt.verifiedAt), now);
        assert.equal(Date.parse(evidence.inventory.observedAt), now);
        assert.equal(calls.filter((call) => call[0] === '/usr/sbin/iptables').length, 2);
        assert.equal(calls.filter((call) => call[0] === 'GET').length, 2);
      },
      managedInventory: async () => ({ observedAt: new Date(actions.now()).toISOString() }),
    }),
    state: async () => ({ LoadState: 'loaded', ActiveState: started && (elapsed < 60000 || fail === 'expiry') ? 'active' : 'inactive',
      MainPID: started && (elapsed < 60000 || fail === 'expiry') ? '123' : '0',
      Restart: 'no', NRestarts: '0', FragmentPath: '/etc/systemd/system/baci-savings-gateway.service',
      DropInPaths: '', NeedDaemonReload: 'no', UnitFileState: 'static',
      InvocationID: started ? (fail === 'replacement' ? 'b'.repeat(32) : 'a'.repeat(32)) : '', }),
    absent: async (path) => fail !== 'collision' && (!path.endsWith('ingress.sock') || elapsed >= 60000),
    noProcesses: async () => {},
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (command === '/usr/sbin/iptables' && fail === 'firewall') throw new Error('SECRET');
      if (command === '/usr/bin/sudo' && args.length > 6 && fail !== 'sudo-allowed') throw Object.assign(new Error('SECRET'), { code: 1 });
      if (args[0] === 'start') started = true;
      if (args[0] === 'stop') started = false;
      return '';
    },
    get: async (options) => {
      calls.push(['GET', options.path]);
      if (options.path === '/auth/v1/user') return fail === 'auth' ? 200 : 401;
      if (options.path === '/auth/v1/admin/users') return 403;
      return 200;
    },
    create: async (name, value, gid, owned) => { const record = { name, value, gid }; files.push(record); owned.push(record); },
    remove: async (record) => { calls.push(['remove', record.name]); if (fail === 'changed-inode') throw new Error('SECRET'); },
    socket: async () => {}, noNewPrivs: async () => 0,
    report: (report) => reports.push(report),
  };
  return { actions, calls, files, reports };
}

test('fresh attestations precede exclusive evidence, real unit path, bounded expiry and cleanup', async () => {
  const { actions, calls, files, reports } = fixture();
  await runPrivateSmoke({ identity, uid: 100, gid: 101 }, actions);
  assert.equal(files.length, 2);
  assert.equal(reports.find((report) => 'noNewPrivs' in report).noNewPrivs, 0);
  assert.equal(reports.at(-1).stage, 'lease-withdrawn');
  assert.equal(calls.filter((call) => call[1] === 'stop').length, 0);
  assert.deepEqual(calls.filter((call) => call[0] === 'remove').map((call) => call[1]), ['startup-evidence', 'binding']);
  for (const call of calls.filter((call) => call[0] === '/usr/bin/sudo')) assert.ok(call.includes('-l'));
  assert.ok(calls.some((call) => call.includes('baci-stg-db') && call.includes('-C')));
  assert.ok(calls.some((call) => call.includes('baci-stg-mail') && call.includes('-C')));
});

for (const failure of ['collision', 'sudo-allowed', 'firewall', 'auth', 'expiry', 'changed-inode']) {
  test(`refuses ${failure} with redacted errors and bounded cleanup`, async () => {
    const { actions, calls, files } = fixture(failure);
    await assert.rejects(runPrivateSmoke({ identity, uid: 100, gid: 101 }, actions), (error) => !error.message.includes('SECRET'));
    if (['collision', 'sudo-allowed', 'firewall'].includes(failure)) {
      assert.equal(files.length, 0);
      assert.ok(!calls.some((call) => call[1] === 'start' || call[1] === 'stop'));
    }
    if (['auth', 'expiry'].includes(failure)) assert.ok(calls.some((call) => call[1] === 'stop'));
  });
}

test('rejects write routes before any host action', async () => {
  const { actions, calls } = fixture();
  const altered = structuredClone(identity);
  altered.restRoutes[0].methods.push('POST');
  await assert.rejects(runPrivateSmoke({ identity: altered, uid: 100, gid: 101 }, actions));
  assert.equal(calls.length, 0);
});

test('keeps the original runner product-only before any host action', async () => {
  const { actions, calls } = fixture();
  const hostedIdentity = structuredClone(identity);
  hostedIdentity.restRoutes.push({
    path: '/rest/v1/rpc/customer_savings_draft_command',
    methods: ['POST'],
  });
  await assert.rejects(
    runPrivateSmoke({ identity: hostedIdentity, uid: 100, gid: 101 }, actions)
  );
  assert.equal(calls.length, 0);
});

test('never stops a replaced invocation after a probe failure', async () => {
  const { actions, calls } = fixture('auth');
  const original = actions.state;
  let states = 0;
  actions.state = async () => {
    const result = await original();
    if (++states >= 5) result.InvocationID = 'b'.repeat(32);
    return result;
  };
  await assert.rejects(runPrivateSmoke({ identity, uid: 100, gid: 101 }, actions), /cleanup incomplete/);
  assert.ok(!calls.some((call) => call[1] === 'stop'));
  assert.ok(!calls.some((call) => call[0] === 'remove'));
});

test('preserves evidence when own service stop fails', async () => {
  const { actions, calls, reports } = fixture('auth');
  const original = actions.run;
  actions.run = async (command, args) => {
    if (args[0] === 'stop') throw new Error('SECRET');
    return original(command, args);
  };
  await assert.rejects(runPrivateSmoke({ identity, uid: 100, gid: 101 }, actions), /cleanup incomplete/);
  assert.ok(!calls.some((call) => call[0] === 'remove'));
  assert.equal(reports.at(-1).stage, 'cleanup');
});

test('environment assignment policy queries do not put assignments after option terminator', async () => {
  const { actions, calls } = fixture();
  await runPrivateSmoke({ identity, uid: 100, gid: 101 }, actions);
  for (const call of calls.filter((entry) => entry[0] === '/usr/bin/sudo' && entry.some((arg) => /^(NODE_OPTIONS|NODE_PATH|LD_PRELOAD)=/.test(arg)))) {
    if (call.includes('/usr/bin/env')) continue;
    assert.ok(!call.includes('--'));
    assert.ok(call.includes('-l'));
  }
});

for (const exitcode of [0, 1]) {
  test(`accepts informational environment listing exit ${exitcode} without execution-filter proof`, async () => {
    const { actions, reports } = fixture();
    const original = actions.run;
    actions.run = async (command, args) => {
      if (command === '/usr/bin/sudo' && args[4]?.includes('=')) {
        if (exitcode === 1) throw Object.assign(new Error('SECRET'), { code: 1 });
        return '';
      }
      return original(command, args);
    };
    await runPrivateSmoke({ identity, uid: 100, gid: 101 }, actions);
    assert.ok(reports.some((report) => report.stage === 'lease-withdrawn'));
    assert.deepEqual(reports.find((report) => report.stage === 'sudo-environment-listing'), {
      stage: 'sudo-environment-listing', exitcodes: [exitcode, exitcode, exitcode], executionFilterProven: false,
    });
  });
}

for (const outcome of [{ code: 2 }, { code: 'ENOENT' }, { code: 1, signal: 'SIGTERM' }, { code: 1, killed: true }]) {
  test(`fails closed on unexpected environment listing outcome ${JSON.stringify(outcome)}`, async () => {
    const { actions, calls, files, reports } = fixture();
    const original = actions.run;
    actions.run = async (command, args) => {
      if (command === '/usr/bin/sudo' && args[4]?.includes('=')) throw Object.assign(new Error('SECRET'), outcome);
      return original(command, args);
    };
    await assert.rejects(runPrivateSmoke({ identity, uid: 100, gid: 101 }, actions));
    assert.equal(files.length, 0);
    assert.ok(!calls.some((call) => call[1] === 'start'));
    assert.deepEqual(reports.at(-1), { stage: 'sudo-policy', status: 'failed', redacted: true });
  });
}

for (const candidate of ['extra', '/usr/bin/node', '/usr/bin/docker', '/usr/bin/env']) {
  test(`still refuses allowed forbidden command ${candidate}`, async () => {
    const { actions, files } = fixture();
    const original = actions.run;
    actions.run = async (command, args) => {
      if (command === '/usr/bin/sudo' && args.includes(candidate)) return '';
      return original(command, args);
    };
    await assert.rejects(runPrivateSmoke({ identity, uid: 100, gid: 101 }, actions));
    assert.equal(files.length, 0);
  });
}

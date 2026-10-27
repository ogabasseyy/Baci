import assert from 'node:assert/strict';

export function fixture(fail = '', leaseMs = 60000) {
  let elapsed = 0;
  let started = false;
  const calls = [];
  const files = [];
  const reports = [];
  const actions = {
    now: () => 1800000000000 + elapsed,
    monotonic: () => elapsed,
    pause: async (duration) => {
      elapsed += duration;
    },
    modules: async () => ({
      validateRoutingIdentityShape: () => {},
      validateRoutingIdentity: () => {},
      validateManagedStartup: (binding, evidence, now) => {
        assert.equal(
          Date.parse(binding.leaseExpiresAt) -
            Date.parse(binding.leaseNotBefore),
          leaseMs
        );
        assert.equal(Date.parse(evidence.receipt.verifiedAt), now);
        assert.equal(Date.parse(evidence.inventory.observedAt), now);
        assert.equal(
          calls.filter((call) => call[0] === '/usr/sbin/iptables').length,
          2
        );
        assert.equal(calls.filter((call) => call[0] === 'GET').length, 2);
      },
      managedInventory: async () => ({
        observedAt: new Date(actions.now()).toISOString(),
      }),
    }),
    state: async () => ({
      LoadState: 'loaded',
      ActiveState:
        started && (elapsed < 60000 || fail === 'expiry')
          ? 'active'
          : 'inactive',
      MainPID: started && (elapsed < 60000 || fail === 'expiry') ? '123' : '0',
      Restart: 'no',
      NRestarts: '0',
      FragmentPath: '/etc/systemd/system/baci-savings-gateway.service',
      DropInPaths: '',
      NeedDaemonReload: 'no',
      UnitFileState: 'static',
      InvocationID: started
        ? fail === 'replacement'
          ? 'b'.repeat(32)
          : 'a'.repeat(32)
        : '',
    }),
    absent: async (path) =>
      fail !== 'collision' &&
      (!path.endsWith('ingress.sock') || elapsed >= 60000),
    noProcesses: async () => {},
    run: async (command, args) => {
      calls.push([command, ...args]);
      if (command === '/usr/sbin/iptables' && fail === 'firewall')
        throw new Error('SECRET');
      if (
        command === '/usr/bin/sudo' &&
        args.length > 6 &&
        fail !== 'sudo-allowed'
      )
        throw Object.assign(new Error('SECRET'), { code: 1 });
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
    create: async (name, value, gid, owned) => {
      const record = { name, value, gid };
      files.push(record);
      owned.push(record);
    },
    remove: async (record) => {
      calls.push(['remove', record.name]);
      if (fail === 'changed-inode') throw new Error('SECRET');
    },
    socket: async () => {},
    noNewPrivs: async () => 0,
    report: (report) => reports.push(report),
  };
  return { actions, calls, files, reports };
}

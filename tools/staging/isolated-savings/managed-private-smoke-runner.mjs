import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readFile, unlink } from 'node:fs/promises';
import { request } from 'node:http';
import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';
import { isDeepStrictEqual, promisify } from 'node:util';
import { managedRouteContract } from './managed-route-contract.mjs';
import { managedLeaseWindow } from './managed-lease-window.mjs';

const unit = 'baci-savings-gateway.service';
const account = 'baci-savings-gateway';
const code = '/opt/baci-savings-gateway';
const config = '/etc/baci-savings-gateway';
const runtime = '/run/baci-savings-gateway';
const socketPath = `${runtime}/ingress.sock`;
const env = {
  PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
  LANG: 'C',
  LC_ALL: 'C',
  HOME: '/',
};
const execute = promisify(execFile);
const requireValue = (value) => {
  if (!value) throw new Error('Rejected');
};
const fingerprint = (info) =>
  ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs', 'uid', 'gid', 'mode', 'nlink']
    .map((key) => info[key])
    .join(':');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const MAX_PRIVATE_SMOKE_LEASE_MS = 7 * 24 * 60 * 60 * 1000;

function nativeActions() {
  const run = async (command, args) =>
    (
      await execute(command, args, {
        env,
        timeout: 8000,
        killSignal: 'SIGKILL',
        maxBuffer: 1048576,
      })
    ).stdout.trim();
  const absent = async (path) => {
    try {
      await lstat(path);
      return false;
    } catch (error) {
      if (error.code === 'ENOENT') return true;
      throw error;
    }
  };
  const state = async () =>
    Object.fromEntries(
      (
        await run('/usr/bin/systemctl', [
          'show',
          unit,
          '--property=LoadState,ActiveState,SubState,MainPID,InvocationID,Restart,NRestarts,FragmentPath,DropInPaths,UnitFileState,NeedDaemonReload',
        ])
      )
        .split('\n')
        .map((line) => line.split('='))
    );
  const get = (options) =>
    new Promise((resolve, reject) => {
      const call = request(
        {
          ...options,
          method: 'GET',
          headers: { Host: 'staging-auth.ogabassey.com' },
        },
        (response) => {
          response.destroy();
          resolve(response.statusCode);
        }
      );
      const timer = setTimeout(() => call.destroy(new Error('Deadline')), 2500);
      call.on('close', () => clearTimeout(timer));
      call.on('error', reject);
      call.end();
    });
  return {
    now: Date.now,
    monotonic: () => performance.now(),
    pause,
    run,
    absent,
    state,
    get,
    modules: async () => ({
      ...(await import(`${code}/managed-gateway.mjs`)),
      ...(await import(`${code}/private-routing-inventory.mjs`)),
      ...(await import(`${code}/managed-inventory-helper.mjs`)),
    }),
    noProcesses: async (uid) => {
      for (const name of await readdir('/proc')) {
        if (!/^\d+$/.test(name)) continue;
        try {
          requireValue((await lstat(`/proc/${name}`)).uid !== uid);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
    },
    create: async (name, value, gid, owned) => {
      const path = `${config}/${name}.json`;
      const file = await open(
        path,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_RDWR |
          constants.O_NOFOLLOW,
        0o600
      );
      const record = {
        path,
        fingerprint: fingerprint(await file.stat()),
        hash: sha(''),
      };
      owned.push(record);
      try {
        await file.writeFile(JSON.stringify(value));
        await file.chown(0, gid);
        await file.chmod(0o440);
        await file.sync();
      } finally {
        record.fingerprint = fingerprint(await file.stat());
        const bytes = Buffer.alloc((await file.stat()).size);
        await file.read(bytes, 0, bytes.length, 0);
        record.hash = sha(bytes);
        await file.close();
      }
    },
    remove: async (record) => {
      requireValue(
        fingerprint(await lstat(record.path)) === record.fingerprint
      );
      requireValue(sha(await readFile(record.path)) === record.hash);
      requireValue(
        fingerprint(await lstat(record.path)) === record.fingerprint
      );
      await unlink(record.path);
    },
    socket: async (uid, gid) => {
      const parent = await lstat(runtime);
      const socket = await lstat(socketPath);
      requireValue(
        parent.isDirectory() &&
          parent.uid === uid &&
          parent.gid === gid &&
          (parent.mode & 0o7777) === 0o750
      );
      requireValue(
        socket.isSocket() &&
          socket.uid === uid &&
          socket.gid === gid &&
          (socket.mode & 0o7777) === 0o660
      );
    },
    noNewPrivs: async (pid) => {
      requireValue(/^[1-9]\d*$/.test(pid));
      const status = await readFile(`/proc/${pid}/status`, 'utf8');
      const value = /^NoNewPrivs:\s+([01])$/m.exec(status)?.[1];
      requireValue(value !== undefined);
      return Number(value);
    },
    report: (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
  };
}

export async function runPrivateSmoke(
  { identity, uid, gid },
  actions = nativeActions(),
  onReady = () => Promise.resolve(),
  {
    leaseMs = 60000,
    retainOnReady = false,
    routeContract = 'product-only',
    leaseExpiresAt,
  } = {}
) {
  let stage = 'preflight';
  let invocation;
  let started = false;
  let interrupted = false;
  let retained = false;
  const owned = [];
  const terminate = () => {
    interrupted = true;
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
    process.on(signal, terminate);
  const check = () => requireValue(!interrupted);
  const state = async () => {
    const value = await actions.state();
    requireValue(
      value.LoadState === 'loaded' &&
        value.Restart === 'no' &&
        value.NRestarts === '0'
    );
    requireValue(
      value.FragmentPath === `/etc/systemd/system/${unit}` &&
        value.DropInPaths === '' &&
        value.NeedDaemonReload === 'no'
    );
    requireValue(['disabled', 'static'].includes(value.UnitFileState));
    return value;
  };
  const stopped = (value) =>
    ['inactive', 'failed'].includes(value.ActiveState) && value.MainPID === '0';
  try {
    const validators = await actions.modules();
    validators.validateRoutingIdentityShape(identity);
    requireValue(routeContract !== 'hosted-funding' || typeof leaseExpiresAt === 'string');
    managedLeaseWindow(actions.now(), leaseMs, leaseExpiresAt);
    requireValue(
      isDeepStrictEqual(
        identity.restRoutes,
        managedRouteContract(routeContract)
      )
    );
    requireValue(!retainOnReady || typeof onReady === 'function');
    requireValue(stopped(await state()) && (await actions.absent(runtime)));
    await actions.noProcesses(uid);
    for (const name of ['binding', 'startup-evidence'])
      requireValue(await actions.absent(`${config}/${name}.json`));
    stage = 'sudo-policy';
    await actions.run('/usr/sbin/visudo', ['-c']);
    const helper = `${code}/managed-inventory-helper.mjs`;
    await actions.run('/usr/bin/sudo', [
      '-n',
      '-l',
      '-U',
      account,
      '--',
      helper,
    ]);
    for (const command of [
      [helper, 'extra'],
      ['/usr/bin/node', helper],
      ['/usr/bin/docker', 'ps'],
      ['/usr/bin/env', 'NODE_OPTIONS=--inspect', helper],
    ]) {
      let denied = false;
      try {
        await actions.run('/usr/bin/sudo', [
          '-n',
          '-l',
          '-U',
          account,
          '--',
          ...command,
        ]);
      } catch (error) {
        denied = error.code === 1 && !error.signal && !error.killed;
      }
      requireValue(denied);
    }
    const exitcodes = [];
    for (const assignment of [
      'NODE_OPTIONS=--inspect',
      'NODE_PATH=/tmp',
      'LD_PRELOAD=/tmp/forbidden.so',
    ]) {
      try {
        await actions.run('/usr/bin/sudo', [
          '-n',
          '-l',
          '-U',
          account,
          assignment,
          helper,
        ]);
        exitcodes.push(0);
      } catch (error) {
        requireValue(error.code === 1 && !error.signal && !error.killed);
        exitcodes.push(1);
      }
    }
    actions.report({
      stage: 'sudo-environment-listing',
      exitcodes,
      executionFilterProven: false,
    });
    check();
    stage = 'fresh-firewall';
    for (const bridge of ['baci-stg-db', 'baci-stg-mail'])
      await actions.run('/usr/sbin/iptables', [
        '-w',
        '5',
        '-C',
        'INPUT',
        '-i',
        bridge,
        '-m',
        'conntrack',
        '--ctstate',
        'NEW',
        '-m',
        'comment',
        '--comment',
        'baci-isolated-savings',
        '-j',
        'DROP',
      ]);
    stage = 'fresh-reachability';
    requireValue(
      (await actions.get({
        hostname: identity.containers.auth.ip,
        port: 9999,
        path: '/health',
      })) === 200
    );
    requireValue(
      (await actions.get({
        hostname: identity.containers.rest.ip,
        port: 3000,
        path: '/',
      })) === 200
    );
    const verifiedAt = new Date(actions.now()).toISOString();
    stage = 'fresh-inventory';
    const start = actions.now();
    const lease = managedLeaseWindow(start, leaseMs, leaseExpiresAt);
    const binding = {
      version: 1,
      identity,
      reviewedAt: new Date(start).toISOString(),
      leaseNotBefore: new Date(start).toISOString(),
      leaseExpiresAt: lease.expiresAt,
    };
    const clockStart = actions.monotonic();
    const inventory = await validators.managedInventory(
      binding,
      (args) => actions.run('/usr/bin/docker', args),
      actions.now
    );
    validators.validateRoutingIdentity(identity, inventory);
    const evidence = {
      receipt: {
        version: 1,
        ...identity,
        verifiedAt,
        firewallVerified: true,
        hostReachabilityVerified: true,
      },
      inventory,
    };
    validators.validateManagedStartup(binding, evidence, actions.now());
    requireValue(actions.now() - start < 5000);
    check();
    stage = 'exclusive-evidence';
    await actions.create('binding', binding, gid, owned);
    await actions.create('startup-evidence', evidence, gid, owned);
    requireValue(stopped(await state()) && (await actions.absent(runtime)));
    check();
    stage = 'start-unit';
    await actions.run('/usr/bin/systemctl', ['start', '--no-block', unit]);
    started = true;
    let current = await actions.state();
    const startDeadline = actions.monotonic() + 5000;
    while (!current.InvocationID && actions.monotonic() < startDeadline) {
      await actions.pause(50);
      current = await actions.state();
    }
    invocation = current.InvocationID;
    requireValue(/^[a-f0-9]{32}$/.test(invocation));
    stage = 'socket-ready';
    const deadline = actions.monotonic() + 10000;
    while (true) {
      check();
      current = await state();
      requireValue(
        current.InvocationID === invocation &&
          ['activating', 'active'].includes(current.ActiveState)
      );
      try {
        await actions.socket(uid, gid);
        break;
      } catch {
        requireValue(actions.monotonic() < deadline);
        await actions.pause(100);
      }
    }
    stage = 'private-get';
    requireValue(
      (await actions.get({ socketPath, path: '/auth/v1/user' })) === 401
    );
    requireValue(
      (await actions.get({ socketPath, path: '/auth/v1/admin/users' })) === 403
    );
    const noNewPrivs = await actions.noNewPrivs(current.MainPID);
    requireValue((await state()).MainPID === current.MainPID);
    actions.report({
      stage: 'private-smoke',
      mainPID: Number(current.MainPID),
      noNewPrivs,
      leaseSeconds: lease.duration / 1000,
    });
    stage = 'nginx-activation';
    await onReady({
      binding,
      evidence,
      leaseExpiresAt: binding.leaseExpiresAt,
    });
    if (retainOnReady) {
      retained = true;
      actions.report({
        stage: 'retained-activation',
        leaseSeconds: lease.duration / 1000,
      });
      return;
    }
    stage = 'lease-withdrawal';
    while (actions.monotonic() - clockStart <= 70000) {
      check();
      current = await state();
      requireValue(
        !current.InvocationID || current.InvocationID === invocation
      );
      if (stopped(current) && (await actions.absent(socketPath))) break;
      await actions.pause(250);
    }
    requireValue(
      actions.monotonic() - clockStart >= 60000 &&
        stopped(current) &&
        (await actions.absent(socketPath))
    );
    actions.report({
      stage: 'lease-withdrawn',
      state: current.ActiveState,
      socketAbsent: true,
      restarted: false,
    });
  } catch {
    actions.report({ stage, status: 'failed', redacted: true });
    throw new Error(`Private smoke failed at ${stage}`);
  } finally {
    let cleanupFailed = false;
    try {
      if (started && !retained) {
        const current = await actions.state();
        if (!stopped(current)) {
          requireValue(invocation && current.InvocationID === invocation);
          await actions.run('/usr/bin/systemctl', ['stop', unit]);
          requireValue(stopped(await actions.state()));
        }
      }
    } catch {
      cleanupFailed = true;
    }
    if (!cleanupFailed && !retained) {
      for (const record of owned.reverse()) {
        try {
          await actions.remove(record);
        } catch {
          cleanupFailed = true;
        }
      }
    }
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
      process.removeListener(signal, terminate);
    if (cleanupFailed) {
      actions.report({
        stage: 'cleanup',
        status: 'failed',
        evidenceMayRemain: true,
        ownerReviewRequired: true,
      });
      // biome-ignore lint/correctness/noUnsafeFinally: evidence cleanup failure requires owner intervention.
      throw new Error(
        'Private smoke cleanup incomplete; owner review required'
      );
    }
  }
}

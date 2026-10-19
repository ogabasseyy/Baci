import { isDeepStrictEqual } from 'node:util';
import { managedLeaseWindow } from './managed-lease-window.mjs';
import { managedRouteContract } from './managed-route-contract.mjs';
import { account, code, config, requireValue, runtime } from './managed-private-smoke-actions.mjs';

export async function runSmokePreflight(ctx) {
  const {
    actions,
    check,
    gid,
    identity,
    leaseExpiresAt,
    leaseMs,
    onReady,
    retainOnReady,
    routeContract,
    state,
    stopped,
    uid,
  } = ctx;
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
    ctx.stage = 'sudo-policy';
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
    ctx.stage = 'fresh-firewall';
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
    ctx.stage = 'fresh-reachability';
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
    ctx.stage = 'fresh-inventory';
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

  ctx.validators = validators;
  ctx.binding = binding;
  ctx.evidence = evidence;
  ctx.lease = lease;
  ctx.clockStart = clockStart;
}

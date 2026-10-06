import { performance } from 'node:perf_hooks';
import {
  code,
  config,
  drafts,
  gateway,
  validateBinding,
  verifyGraph,
} from './funding-gateway-recovery-identity.mjs';
import {
  gatewayAccount,
  replaceEvidence,
  requestStatus,
  run,
  serviceState,
  verifySocket,
} from './funding-gateway-recovery-probes.mjs';

export {
  parseState,
  validateBinding,
} from './funding-gateway-recovery-identity.mjs';
export { gatewayAccount } from './funding-gateway-recovery-probes.mjs';

export async function recover(provided, modules) {
  const actions = {
    now: Date.now,
    monotonic: () => performance.now(),
    run,
    requestStatus,
    serviceState,
    replaceEvidence,
    gatewayAccount,
    verifyGraph,
    verifySocket,
    ...provided,
  };
  const report = (stage) => actions.report?.({ stage });
  const now = actions.now();
  report('graph-verification');
  await actions.verifyGraph();
  report('module-loading');
  const loaded =
    modules ??
    (await Promise.all([
      import(`${code}/managed-files.mjs`),
      import(`${code}/managed-inventory-helper.mjs`),
      import(`${code}/managed-gateway.mjs`),
      import(`${code}/private-routing-inventory.mjs`),
    ]));
  const [
    { readManagedFile },
    { managedInventory },
    { validateManagedStartup },
    { validateRoutingIdentity },
  ] = loaded;
  report('binding-read');
  const bindingFile = await readManagedFile(`${config}/binding.json`);
  report('binding-validation');
  const identity = validateBinding(bindingFile.value, now);
  report('service-preflight');
  const stopped = await actions.serviceState(gateway);
  const retained = await actions.serviceState(drafts);
  if (
    !['inactive', 'failed'].includes(stopped.ActiveState) ||
    stopped.MainPID !== '0' ||
    retained.ActiveState !== 'active' ||
    !/^[1-9]\d*$/.test(retained.MainPID)
  )
    throw new Error('Recovery state rejected');
  report('firewall-preflight');
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
  report('reachability-preflight');
  if (
    (await actions.requestStatus({
      hostname: identity.containers.auth.ip,
      port: 9999,
      path: '/health',
    })) !== 200 ||
    (await actions.requestStatus({
      hostname: identity.containers.rest.ip,
      port: 3000,
      path: '/',
    })) !== 200
  )
    throw new Error('Reachability rejected');
  report('inventory-preflight');
  const inventoryStarted = actions.now();
  const inventory = await managedInventory(
    bindingFile.value,
    (argumentsList) => actions.run('/usr/bin/docker', argumentsList),
    actions.now
  );
  validateRoutingIdentity(identity, inventory);
  const evidence = {
    inventory,
    receipt: {
      ...identity,
      firewallVerified: true,
      hostReachabilityVerified: true,
      verifiedAt: new Date(inventoryStarted).toISOString(),
      version: 1,
    },
  };
  validateManagedStartup(bindingFile.value, evidence, actions.now());
  if (actions.now() - inventoryStarted >= 5000)
    throw new Error('Fresh evidence rejected');
  report('refresh-evidence');
  await actions.replaceEvidence(evidence);
  const unchanged = await actions.serviceState(gateway);
  if (
    !['inactive', 'failed'].includes(unchanged.ActiveState) ||
    unchanged.MainPID !== '0'
  )
    throw new Error('Recovery state rejected');
  report('start-gateway');
  await actions.run('/usr/bin/systemctl', ['start', '--no-block', gateway]);
  const accountInfo = await actions.gatewayAccount();
  const until = actions.monotonic() + 10000;
  while (actions.monotonic() < until) {
    const current = await actions.serviceState(gateway);
    if (
      current.ActiveState === 'active' &&
      /^[1-9]\d*$/.test(current.MainPID) &&
      /^[a-f0-9]{32}$/.test(current.InvocationID)
    ) {
      try {
        await actions.verifySocket(identity, accountInfo);
        return { elapsedMs: actions.now() - now, status: 'recovered' };
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Gateway startup rejected');
}

async function main() {
  if (
    process.platform !== 'linux' ||
    process.geteuid() !== 0 ||
    process.argv.length !== 3 ||
    process.argv[2] !== '--recover'
  )
    throw new Error('Root recovery invocation required');
  const value = await recover({
    report: (value) => process.stdout.write(`${JSON.stringify(value)}\n`),
  });
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(() => {
    process.stderr.write(
      'Funding gateway recovery refused; no binding change occurred.\n'
    );
    process.exitCode = 1;
  });
}

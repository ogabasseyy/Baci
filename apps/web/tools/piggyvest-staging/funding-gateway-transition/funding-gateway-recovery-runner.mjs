#!/usr/bin/node
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readFile, rename } from 'node:fs/promises';
import { request } from 'node:http';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

const account = 'baci-savings-gateway';
const code = '/opt/baci-savings-gateway';
const config = '/etc/baci-savings-gateway';
const deadlineSecond = 1790697550;
const drafts = 'baci-savings-drafts.service';
const gateway = 'baci-savings-gateway.service';
const environment = { HOME: '/', LANG: 'C', LC_ALL: 'C', PATH: '/usr/sbin:/usr/bin:/sbin:/bin' };
const routes = [
  { path: '/rest/v1/products', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/customers', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/merchants', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/rpc/customer_savings_draft_command', methods: ['POST'] },
  { path: '/rest/v1/rpc/get_storefront_product_variants', methods: ['POST'] },
];
// Post-transition contract: recovery must keep working after activation, so
// both the pre-transition five routes and the eleven-route contract validate.
const transitionedRoutes = [
  { path: '/rest/v1/products', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/customers', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/merchants', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/rpc/customer_savings_draft_command', methods: ['POST'] },
  { path: '/rest/v1/rpc/get_storefront_product_variants', methods: ['POST'] },
  { path: '/rest/v1/customer_savings_goals', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/rpc/get_merchant_paystack_subaccount_code', methods: ['POST'] },
  { path: '/rest/v1/rpc/get_customer_savings_feature_settings', methods: ['POST'] },
  { path: '/rest/v1/rpc/create_customer_savings_goal', methods: ['POST'] },
  { path: '/rest/v1/piggyvest_plan_wallets', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/piggyvest_interest_payouts', methods: ['GET', 'HEAD'] },
];
const execute = promisify(execFile);
const graph = {
  '/etc/systemd/system/baci-savings-gateway.service': '8539934f7d9a499e93158388843097cda7c31a398c22df4d8e9a0400170a0bf3',
  [`${code}/compose.mjs`]: '7e34a257b21c9527d97aaac4ffc3957225b55d3be6e08455bd7b272eba5575dd',
  [`${code}/managed-files.mjs`]: 'd9d0c6cbfeddbf6ecd249dd9760d8cd09f38880fdcbefc7a0cdbd79e1553b061',
  [`${code}/managed-gateway-cli.mjs`]: '314f63daa895429a5ba4134e2b748edcc5f0c41965a3b6740ce102fd69162866',
  [`${code}/managed-gateway.mjs`]: '94f3d2ecbf6b1adc437b84c75afc6b8a921b19d212dcfe34f8625e84bae50825',
  [`${code}/managed-inventory-helper.mjs`]: 'e78e34607bab7b5eac71878527081f808199e89f999d46c638b5ac298529a80d',
  [`${code}/private-routing-inventory.mjs`]: 'f8feff6a3b48645f0ae44d25cf1ab18952e0c11510a2aeac2f6f6cd898c4ddbd',
  [`${code}/private-routing-supervisor-child.py`]: '6dfdedd0d182d8b836c7a67b30d50c7049e6f7b5272ceb7ba4da507b2723b16d',
  [`${code}/private-routing-supervisor-inventory.mjs`]: '6205de16870dfb1e5219df2cafc2fdd6252505d0f3349a1064e0ffe8b49f7781',
  [`${code}/private-routing.mjs`]: '8aa326f61e6de815a8cd6a16aca1fbae92eb8db925e0d65dc4b25a93c32a0617',
};

export function parseState(output, names, blank = []) {
  const values = {};
  for (const line of output.split('\n')) {
    const [name, ...parts] = line.split('=');
    if (!names.includes(name)) continue;
    const value = parts.join('=');
    if ((!value && !blank.includes(name)) || Object.hasOwn(values, name)) throw new Error('Systemd state rejected');
    values[name] = value;
  }
  if (names.some((name) => !Object.hasOwn(values, name)))
    throw new Error('Systemd state rejected');
  return values;
}

async function verifyGraph() {
  for (const [path, expected] of Object.entries(graph)) {
    for (let parent = new URL('.', `file://${path}`).pathname; parent !== '/'; parent = parent.slice(0, parent.lastIndexOf('/')) || '/') {
      const info = await lstat(parent);
      if (!info.isDirectory() || info.uid !== 0 || info.mode & 0o022) throw new Error('Pinned graph rejected');
    }
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = await file.stat();
      const bytes = await file.readFile();
      const after = await file.stat();
      if (!before.isFile() || before.uid !== 0 || before.nlink !== 1 || before.mode & 0o022 || before.dev !== after.dev || before.ino !== after.ino || createHash('sha256').update(bytes).digest('hex') !== expected)
        throw new Error('Pinned graph rejected');
    } finally {
      await file.close();
    }
  }
}

export function validateBinding(binding, now) {
  const end = Date.parse(binding?.leaseExpiresAt);
  if (
    !binding ||
    Object.keys(binding).sort().join(',') !== 'identity,leaseExpiresAt,leaseNotBefore,reviewedAt,version' ||
    binding.version !== 1 ||
    !Number.isFinite(end) ||
    Math.floor(end / 1000) !== deadlineSecond ||
    new Date(binding.leaseExpiresAt).toISOString() !== binding.leaseExpiresAt ||
    end <= now ||
    (JSON.stringify(binding.identity?.restRoutes) !== JSON.stringify(routes) &&
      JSON.stringify(binding.identity?.restRoutes) !== JSON.stringify(transitionedRoutes))
  )
    throw new Error('Pinned binding rejected');
  return binding.identity;
}

function run(command, argumentsList) {
  return execute(command, argumentsList, {
    env: environment,
    killSignal: 'SIGKILL',
    maxBuffer: 1048576,
    timeout: 8000,
  }).then(({ stdout }) => stdout.trim());
}

async function serviceState(name) {
  const state = parseState(
    await run('/usr/bin/systemctl', [
      'show',
      name,
      '--property=LoadState,ActiveState,MainPID,InvocationID,Restart,NRestarts,FragmentPath,DropInPaths,NeedDaemonReload',
      '--no-pager',
    ]),
    ['LoadState', 'ActiveState', 'MainPID', 'InvocationID', 'Restart', 'NRestarts', 'FragmentPath', 'DropInPaths', 'NeedDaemonReload'], ['DropInPaths', 'InvocationID']
  );
  if (
    state.LoadState !== 'loaded' ||
    state.FragmentPath !== `/etc/systemd/system/${name}` ||
    state.Restart !== 'no' ||
    state.NRestarts !== '0' ||
    state.DropInPaths !== '' ||
    state.NeedDaemonReload !== 'no'
  )
    throw new Error('Systemd state rejected');
  return state;
}

function requestStatus(options) {
  return new Promise((resolve, reject) => {
    const call = request({ ...options, headers: { Host: 'staging-auth.ogabassey.com' }, method: 'GET' }, (response) => {
      response.destroy();
      resolve(response.statusCode);
    });
    const timer = setTimeout(() => call.destroy(new Error('Reachability rejected')), 2500);
    call.on('close', () => clearTimeout(timer));
    call.on('error', reject);
    call.end();
  });
}

export async function gatewayAccount(read = readFile, command = run) {
  const [fields, unit] = await Promise.all([
    command('/usr/bin/getent', ['passwd', account]).then((value) => value.split(':')),
    read('/etc/systemd/system/baci-savings-gateway.service', 'utf8'),
  ]);
  const group = /^Group=([^\n\r]+)$/m.exec(unit)?.[1];
  const groupFields = group ? (await command('/usr/bin/getent', ['group', group])).split(':') : [];
  if (fields.length !== 7 || !/^\d+$/.test(fields[2]) || groupFields.length !== 4 || !/^\d+$/.test(groupFields[2]) || !/^User=baci-savings-gateway$/m.test(unit))
    throw new Error('Gateway account rejected');
  return { gid: Number(groupFields[2]), uid: Number(fields[2]) };
}

async function replaceEvidence(evidence) {
  const existing = await lstat(`${config}/startup-evidence.json`);
  if (!existing.isFile() || existing.uid !== 0 || existing.nlink !== 1 || (existing.mode & 0o777) !== 0o440)
    throw new Error('Startup evidence rejected');
  const temporary = `${config}/.startup-evidence-${process.pid}.json`;
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(JSON.stringify(evidence));
    await file.chown(0, existing.gid);
    await file.chmod(0o440);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temporary, `${config}/startup-evidence.json`);
}

async function verifySocket(identity, accountInfo) {
  const [runtime, socket] = await Promise.all([
    lstat('/run/baci-savings-gateway'),
    lstat('/run/baci-savings-gateway/ingress.sock'),
  ]);
  if (
    !runtime.isDirectory() || runtime.uid !== accountInfo.uid || runtime.gid !== accountInfo.gid || (runtime.mode & 0o7777) !== 0o750 ||
    !socket.isSocket() || socket.uid !== accountInfo.uid || socket.gid !== accountInfo.gid || (socket.mode & 0o7777) !== 0o660 ||
    !identity.containers || !identity.networks
  )
    throw new Error('Gateway socket rejected');
}

export async function recover(provided = {}, modules) {
  const actions = { now: Date.now, monotonic: () => performance.now(), run, requestStatus, serviceState, replaceEvidence, gatewayAccount, verifyGraph, verifySocket, ...provided };
  const report = (stage) => actions.report?.({ stage });
  const now = actions.now();
  report('graph-verification');
  await actions.verifyGraph();
  report('module-loading');
  const loaded = modules ?? await Promise.all([import(`${code}/managed-files.mjs`), import(`${code}/managed-inventory-helper.mjs`), import(`${code}/managed-gateway.mjs`), import(`${code}/private-routing-inventory.mjs`)]);
  const [{ readManagedFile }, { managedInventory }, { validateManagedStartup }, { validateRoutingIdentity }] = loaded;
  report('binding-read');
  const bindingFile = await readManagedFile(`${config}/binding.json`);
  report('binding-validation');
  const identity = validateBinding(bindingFile.value, now);
  report('service-preflight');
  const stopped = await actions.serviceState(gateway);
  const retained = await actions.serviceState(drafts);
  if (
    !['inactive', 'failed'].includes(stopped.ActiveState) || stopped.MainPID !== '0' ||
    retained.ActiveState !== 'active' || !/^[1-9]\d*$/.test(retained.MainPID)
  )
    throw new Error('Recovery state rejected');
  report('firewall-preflight');
  for (const bridge of ['baci-stg-db', 'baci-stg-mail'])
    await actions.run('/usr/sbin/iptables', ['-w', '5', '-C', 'INPUT', '-i', bridge, '-m', 'conntrack', '--ctstate', 'NEW', '-m', 'comment', '--comment', 'baci-isolated-savings', '-j', 'DROP']);
  report('reachability-preflight');
  if (
    (await actions.requestStatus({ hostname: identity.containers.auth.ip, port: 9999, path: '/health' })) !== 200 ||
    (await actions.requestStatus({ hostname: identity.containers.rest.ip, port: 3000, path: '/' })) !== 200
  )
    throw new Error('Reachability rejected');
  report('inventory-preflight');
  const inventoryStarted = actions.now();
  const inventory = await managedInventory(bindingFile.value, (argumentsList) => actions.run('/usr/bin/docker', argumentsList), actions.now);
  validateRoutingIdentity(identity, inventory);
  const evidence = { inventory, receipt: { ...identity, firewallVerified: true, hostReachabilityVerified: true, verifiedAt: new Date(inventoryStarted).toISOString(), version: 1 } };
  validateManagedStartup(bindingFile.value, evidence, actions.now());
  if (actions.now() - inventoryStarted >= 5000) throw new Error('Fresh evidence rejected');
  report('refresh-evidence');
  await actions.replaceEvidence(evidence);
  const unchanged = await actions.serviceState(gateway);
  if (!['inactive', 'failed'].includes(unchanged.ActiveState) || unchanged.MainPID !== '0')
    throw new Error('Recovery state rejected');
  report('start-gateway');
  await actions.run('/usr/bin/systemctl', ['start', '--no-block', gateway]);
  const accountInfo = await actions.gatewayAccount();
  const until = actions.monotonic() + 10000;
  while (actions.monotonic() < until) {
    const current = await actions.serviceState(gateway);
    if (current.ActiveState === 'active' && /^[1-9]\d*$/.test(current.MainPID) && /^[a-f0-9]{32}$/.test(current.InvocationID)) {
      try {
        await actions.verifySocket(identity, accountInfo);
        return { elapsedMs: actions.now() - now, status: 'recovered' };
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Gateway startup rejected');
}

async function main() {
  if (process.platform !== 'linux' || process.geteuid() !== 0 || process.argv.length !== 3 || process.argv[2] !== '--recover')
    throw new Error('Root recovery invocation required');
  const value = await recover({ report: (value) => process.stdout.write(`${JSON.stringify(value)}\n`) });
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch(() => {
    process.stderr.write('Funding gateway recovery refused; no binding change occurred.\n');
    process.exitCode = 1;
  });
}

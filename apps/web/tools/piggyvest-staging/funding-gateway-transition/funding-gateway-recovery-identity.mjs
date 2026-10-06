import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { promisify } from 'node:util';

const account = 'baci-savings-gateway';
const code = '/opt/baci-savings-gateway';
const config = '/etc/baci-savings-gateway';
const deadlineSecond = 1790697550;
const drafts = 'baci-savings-drafts.service';
const gateway = 'baci-savings-gateway.service';
const environment = {
  HOME: '/',
  LANG: 'C',
  LC_ALL: 'C',
  PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
};
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
  {
    path: '/rest/v1/rpc/get_merchant_paystack_subaccount_code',
    methods: ['POST'],
  },
  {
    path: '/rest/v1/rpc/get_customer_savings_feature_settings',
    methods: ['POST'],
  },
  { path: '/rest/v1/rpc/create_customer_savings_goal', methods: ['POST'] },
  { path: '/rest/v1/piggyvest_plan_wallets', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/piggyvest_interest_payouts', methods: ['GET', 'HEAD'] },
];
const execute = promisify(execFile);
const graph = {
  '/etc/systemd/system/baci-savings-gateway.service':
    '8539934f7d9a499e93158388843097cda7c31a398c22df4d8e9a0400170a0bf3',
  [`${code}/compose.mjs`]:
    '7e34a257b21c9527d97aaac4ffc3957225b55d3be6e08455bd7b272eba5575dd',
  [`${code}/managed-files.mjs`]:
    'd9d0c6cbfeddbf6ecd249dd9760d8cd09f38880fdcbefc7a0cdbd79e1553b061',
  [`${code}/managed-gateway-cli.mjs`]:
    '314f63daa895429a5ba4134e2b748edcc5f0c41965a3b6740ce102fd69162866',
  [`${code}/managed-gateway.mjs`]:
    '94f3d2ecbf6b1adc437b84c75afc6b8a921b19d212dcfe34f8625e84bae50825',
  [`${code}/managed-inventory-helper.mjs`]:
    'e78e34607bab7b5eac71878527081f808199e89f999d46c638b5ac298529a80d',
  [`${code}/private-routing-inventory.mjs`]:
    'f8feff6a3b48645f0ae44d25cf1ab18952e0c11510a2aeac2f6f6cd898c4ddbd',
  [`${code}/private-routing-supervisor-child.py`]:
    '6dfdedd0d182d8b836c7a67b30d50c7049e6f7b5272ceb7ba4da507b2723b16d',
  [`${code}/private-routing-supervisor-inventory.mjs`]:
    '6205de16870dfb1e5219df2cafc2fdd6252505d0f3349a1064e0ffe8b49f7781',
  [`${code}/private-routing.mjs`]:
    '8aa326f61e6de815a8cd6a16aca1fbae92eb8db925e0d65dc4b25a93c32a0617',
};

export { account, code, config, drafts, environment, execute, gateway };

export function parseState(output, names, blank = []) {
  const values = {};
  for (const line of output.split('\n')) {
    const [name, ...parts] = line.split('=');
    if (!names.includes(name)) continue;
    const value = parts.join('=');
    if ((!value && !blank.includes(name)) || Object.hasOwn(values, name))
      throw new Error('Systemd state rejected');
    values[name] = value;
  }
  if (names.some((name) => !Object.hasOwn(values, name)))
    throw new Error('Systemd state rejected');
  return values;
}

export async function verifyGraph() {
  for (const [path, expected] of Object.entries(graph)) {
    for (
      let parent = new URL('.', `file://${path}`).pathname;
      parent !== '/';
      parent = parent.slice(0, parent.lastIndexOf('/')) || '/'
    ) {
      const info = await lstat(parent);
      if (!info.isDirectory() || info.uid !== 0 || info.mode & 0o022)
        throw new Error('Pinned graph rejected');
    }
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    );
    try {
      const before = await file.stat();
      const bytes = await file.readFile();
      const after = await file.stat();
      if (
        !before.isFile() ||
        before.uid !== 0 ||
        before.nlink !== 1 ||
        before.mode & 0o022 ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        createHash('sha256').update(bytes).digest('hex') !== expected
      )
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
    Object.keys(binding).sort().join(',') !==
      'identity,leaseExpiresAt,leaseNotBefore,reviewedAt,version' ||
    binding.version !== 1 ||
    !Number.isFinite(end) ||
    Math.floor(end / 1000) !== deadlineSecond ||
    new Date(binding.leaseExpiresAt).toISOString() !== binding.leaseExpiresAt ||
    end <= now ||
    (JSON.stringify(binding.identity?.restRoutes) !== JSON.stringify(routes) &&
      JSON.stringify(binding.identity?.restRoutes) !==
        JSON.stringify(transitionedRoutes))
  )
    throw new Error('Pinned binding rejected');
  return binding.identity;
}


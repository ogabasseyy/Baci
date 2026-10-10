import { isDeepStrictEqual } from 'node:util';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { runPrivateSmoke } from './managed-private-smoke-runner.mjs';

const leaseMs = 7 * 24 * 60 * 60 * 1000;
const hostedDraftRoutes = [
  { path: '/rest/v1/products', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/customers', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/merchants', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/rpc/customer_savings_draft_command', methods: ['POST'] },
  {
    path: '/rest/v1/rpc/get_storefront_product_variants',
    methods: ['POST'],
  },
];

export async function runHostedDraftRenewal(input, actions) {
  if (!isDeepStrictEqual(input.identity.restRoutes, hostedDraftRoutes))
    throw new Error('Renewal routes rejected');
  return runPrivateSmoke(input, actions, async () => {}, {
    leaseMs,
    retainOnReady: true,
    routeContract: 'hosted-draft',
  });
}

async function main() {
  if (
    process.platform !== 'linux' ||
    process.geteuid() !== 0 ||
    process.argv.length !== 5 ||
    process.argv[2] !== '--renew'
  )
    throw new Error('Owner renewal required');
  const uid = Number(process.argv[3]);
  const gid = Number(process.argv[4]);
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid))
    throw new Error('Owner renewal identity rejected');
  const identity = JSON.parse(
    await readFile(new URL('./managed-hosted-draft-identity.json', import.meta.url))
  );
  await runHostedDraftRenewal({ identity, uid, gid });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {
    process.stderr.write('Seven-day renewal refused; inspect the fresh receipt.\n');
    process.exitCode = 1;
  });

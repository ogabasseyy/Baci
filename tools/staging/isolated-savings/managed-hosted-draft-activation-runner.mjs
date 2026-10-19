import { isDeepStrictEqual } from 'node:util';
import { runPrivateSmoke } from './managed-private-smoke-runner.mjs';

export const hostedDraftRoutes = [
  { path: '/rest/v1/products', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/customers', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/merchants', methods: ['GET', 'HEAD'] },
  { path: '/rest/v1/rpc/customer_savings_draft_command', methods: ['POST'] },
  {
    path: '/rest/v1/rpc/get_storefront_product_variants',
    methods: ['POST'],
  },
];

const leaseMs = 86_400_000;

function requireValue(value) {
  if (!value) throw new Error('Rejected');
}

export async function runHostedDraftActivation(input, actions, activate) {
  requireValue(typeof activate === 'function');
  requireValue(isDeepStrictEqual(input.identity.restRoutes, hostedDraftRoutes));
  const result = await runPrivateSmoke(input, actions, activate, {
    leaseMs,
    retainOnReady: true,
    routeContract: 'hosted-draft',
  });
  return result;
}

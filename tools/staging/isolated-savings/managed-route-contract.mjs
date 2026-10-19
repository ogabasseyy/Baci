import { fundingRouteContract } from './managed-funding-route-contract.mjs';

export function managedRouteContract(name) {
  const funding = fundingRouteContract();
  if (name === 'product-only') return funding.slice(0, 1);
  if (name === 'hosted-draft') return funding.slice(0, 5);
  if (name === 'hosted-funding') return funding;
  throw new Error('Route contract rejected');
}

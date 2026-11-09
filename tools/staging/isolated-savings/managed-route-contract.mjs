import { fundingRouteContract } from './managed-funding-route-contract.mjs';
import { walletPinRouteContract } from './managed-wallet-pin-route-contract.mjs';

export function managedRouteContract(name) {
  const funding = fundingRouteContract();
  if (name === 'product-only') return funding.slice(0, 1);
  if (name === 'hosted-draft') return funding.slice(0, 5);
  if (name === 'hosted-funding') return funding;
  if (name === 'hosted-wallet-pin') return walletPinRouteContract();
  throw new Error('Route contract rejected');
}

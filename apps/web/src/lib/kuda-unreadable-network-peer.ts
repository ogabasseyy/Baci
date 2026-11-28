import { type Biller, NetworkProvider } from './kuda';
import { providerMatchesNetwork } from './kuda-provider-matches-network';

/**
 * Whether a malformed plan list could hide the exact plan's code at another
 * price: the plan's own provider, a provider on the requested network, or a
 * provider on the plan's own network (whatever network the purchase sent).
 */
export function hasUnreadableNetworkPeer(
  providers: Biller[],
  planProvider: Biller,
  requestedNetwork: NetworkProvider
): boolean {
  const planNetworks = Object.values(NetworkProvider).filter((network) =>
    providerMatchesNetwork(planProvider, network)
  );
  return providers.some(
    (provider) =>
      provider.packagesUnreadable === true &&
      (provider === planProvider ||
        providerMatchesNetwork(provider, requestedNetwork) ||
        planNetworks.some((network) =>
          providerMatchesNetwork(provider, network)
        ))
  );
}

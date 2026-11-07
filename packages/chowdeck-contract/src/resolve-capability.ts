import type { ChowdeckProviderContractV1 } from './schemas/provider-contract';

export type ChowdeckCapability =
  | 'account.read'
  | 'catalog.read'
  | 'catalog.write'
  | 'media.write'
  | 'order.read'
  | 'command.write';

export function resolveCapability(
  contract: ChowdeckProviderContractV1,
  capability: ChowdeckCapability
): { enabled: false; code: string } {
  const keyByCapability = {
    'account.read': 'accountRead',
    'catalog.read': 'catalogRead',
    'catalog.write': 'catalogWrite',
    'media.write': 'mediaWrite',
    'order.read': 'orderRead',
    'command.write': 'commandWrite',
  } as const;
  return contract.capabilities[keyByCapability[capability]];
}

export type { ChowdeckProviderErrorV1 } from './normalize-provider-error';

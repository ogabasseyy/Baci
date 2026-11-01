import {
  type ChowdeckProviderContractV1,
  providerContractSchema,
} from './schemas/provider-contract';

export type ChowdeckCapability =
  | 'account.read'
  | 'catalog.read'
  | 'catalog.write'
  | 'media.write'
  | 'order.read'
  | 'command.write';

export type ChowdeckProviderErrorV1 = {
  code:
    | 'provider_authentication_failed'
    | 'provider_rate_limited'
    | 'provider_unavailable'
    | 'provider_response_invalid';
};

type ContractInput = Pick<
  ChowdeckProviderContractV1,
  'capturedAt' | 'observationManifestDigest' | 'publicContractDigest'
>;

export function createProvisionalProviderContract(
  input: ContractInput
): ChowdeckProviderContractV1 {
  return parseProviderContract({
    contractVersion: 1,
    ...input,
    capabilities: {
      accountRead: {
        enabled: false,
        code: 'provider_response_schema_unproven',
      },
      catalogRead: {
        enabled: false,
        code: 'provider_pagination_unproven',
      },
      catalogWrite: { enabled: false, code: 'provider_contract_unproven' },
      mediaWrite: { enabled: false, code: 'provider_contract_unproven' },
      orderRead: { enabled: false, code: 'provider_contract_unproven' },
      commandWrite: { enabled: false, code: 'provider_contract_unproven' },
    },
  });
}

export function parseProviderContract(
  input: unknown
): ChowdeckProviderContractV1 {
  try {
    return providerContractSchema.parse(input);
  } catch {
    throw new Error('Invalid provider contract');
  }
}

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

export function normalizeProviderError(input: {
  status?: number;
  unsafeCause?: unknown;
}): ChowdeckProviderErrorV1 {
  if (input.status === 401 || input.status === 403)
    return { code: 'provider_authentication_failed' };
  if (input.status === 429) return { code: 'provider_rate_limited' };
  if (input.status !== undefined && input.status >= 500)
    return { code: 'provider_unavailable' };
  return { code: 'provider_response_invalid' };
}

export type { ChowdeckProviderContractV1 };

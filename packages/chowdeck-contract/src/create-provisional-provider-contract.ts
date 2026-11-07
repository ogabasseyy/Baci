import { parseProviderContract } from './parse-provider-contract';
import type { ChowdeckProviderContractV1 } from './schemas/provider-contract';

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

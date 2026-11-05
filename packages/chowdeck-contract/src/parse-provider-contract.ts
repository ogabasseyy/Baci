import {
  type ChowdeckProviderContractV1,
  providerContractSchema,
} from './schemas/provider-contract';

export function parseProviderContract(
  input: unknown
): ChowdeckProviderContractV1 {
  try {
    return providerContractSchema.parse(input);
  } catch {
    throw new Error('Invalid provider contract');
  }
}

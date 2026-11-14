import { createHash } from 'node:crypto';
import {
  oxygenBankListSchema,
  oxygenBankProviderListSchema,
} from '@/schemas/oxygen-bank-details';
import type { OxygenEnvironment } from './environment';

type Bank = { name: string; code: string };
type Cache = {
  get(key: string): Promise<unknown>;
  set(key: string, value: { banks: Bank[] }): Promise<unknown>;
};
type Provider = {
  call(operation: 'banks', input: Record<string, unknown>): Promise<unknown>;
};
function key(environment: OxygenEnvironment, partner: string) {
  const digest = createHash('sha256').update(partner).digest('hex');
  return `oxygen:supported-banks:${environment}:${digest}:v1`;
}
export async function readSupportedBanks(
  cache: Cache,
  environment: OxygenEnvironment,
  partner: string
): Promise<Bank[] | null> {
  const parsed = oxygenBankListSchema.safeParse(
    await cache.get(key(environment, partner))
  );
  return parsed.success ? parsed.data.banks : null;
}
/** Never replace the last good cache entry on a failed or malformed refresh. */
export async function refreshSupportedBanks(
  cache: Cache,
  provider: Provider,
  environment: OxygenEnvironment,
  partner: string
): Promise<Bank[]> {
  const result = oxygenBankProviderListSchema.parse(
    await provider.call('banks', {})
  );
  const banks = oxygenBankListSchema.parse({
    banks: result.Result.map(({ Name, SortCode }) => ({
      name: Name,
      code: SortCode,
    })),
  }).banks;
  await cache.set(key(environment, partner), { banks });
  return banks;
}

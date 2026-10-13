import 'server-only';
import { piggyvestTransactionReconciliationSchema as schemas } from '@/schemas/piggyvest-transaction-reconciliation';
import { requestPiggyvestStagingJson } from './staging-json-request';

export async function requestPiggyvestTransaction({
  configuration,
  binding,
  fetchImplementation,
}: {
  configuration: unknown;
  binding: unknown;
  fetchImplementation: typeof fetch;
}): Promise<unknown> {
  const settings = schemas.configuration.parse(configuration);
  const ownership = schemas.binding.parse(binding);
  return await requestPiggyvestStagingJson({
    configuration: settings,
    path: `/api/v1/transaction/${encodeURIComponent(ownership.transactionId)}?wallet_id=${encodeURIComponent(ownership.walletId)}`,
    method: 'GET',
    fetchImplementation,
  });
}

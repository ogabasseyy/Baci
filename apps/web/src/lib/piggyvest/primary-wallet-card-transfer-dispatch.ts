import 'server-only';
import { createPrimaryCardTransferConnection } from './primary-wallet-card-transfer-connection';
import { readPrimaryCardTransferRuntime } from './primary-wallet-card-transfer-runtime';

export async function dispatchPrimaryCardProviderTransfer(input: {
  operationId: string;
  environment?: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
}) {
  input.signal?.throwIfAborted();
  const configuration = readPrimaryCardTransferRuntime(
    input.environment,
    (input.now ?? Date.now)()
  );
  if (!configuration)
    throw new Error('Primary card transfer configuration unavailable');
  return await createPrimaryCardTransferConnection({
    configuration,
    fetchImplementation: input.fetchImplementation ?? fetch,
    now: input.now,
    signal: input.signal,
  })(input.operationId);
}

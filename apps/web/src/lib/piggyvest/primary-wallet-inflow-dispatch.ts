import 'server-only';
import { createPrimaryWalletInflowExecutor } from './primary-wallet-inflow-executor';
import { readPrimaryWalletInflowRuntime } from './primary-wallet-inflow-runtime';
import { applyPrimaryWalletSignedInflow } from './primary-wallet-signed-inflow';

export async function dispatchPrimaryWalletInflow(input: {
  rawBody: Uint8Array;
  signature: string | null;
  secret: string | undefined;
}) {
  const runtime = readPrimaryWalletInflowRuntime();
  if (!runtime) return 'disabled' as const;
  return await applyPrimaryWalletSignedInflow({
    ...input,
    apply: createPrimaryWalletInflowExecutor(runtime),
  });
}

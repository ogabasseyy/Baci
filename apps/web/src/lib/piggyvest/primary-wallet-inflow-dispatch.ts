import 'server-only';
import { createPrimaryWalletInflowExecutor } from './primary-wallet-inflow-executor';
import { readPrimaryWalletInflowRuntime } from './primary-wallet-inflow-runtime';
import { applyPrimaryWalletSignedInflow } from './primary-wallet-signed-inflow';
import type { PiggyvestWebhookKeyFamily } from './webhook-secret-union';

export async function dispatchPrimaryWalletInflow(input: {
  rawBody: Uint8Array;
  signature: string | null;
  secret: string | undefined;
  families: readonly PiggyvestWebhookKeyFamily[];
}) {
  // Key-family binding: only bank or legacy keys authorize inflow credit.
  // Any other family passes through unmapped so the route quarantines the
  // delivery instead of crediting from a foreign signing key.
  if (!input.families.includes('bank') && !input.families.includes('legacy'))
    return 'unmapped' as const;
  const runtime = readPrimaryWalletInflowRuntime();
  if (!runtime) return 'disabled' as const;
  return await applyPrimaryWalletSignedInflow({
    ...input,
    apply: createPrimaryWalletInflowExecutor(runtime),
  });
}

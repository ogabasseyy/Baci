/**
 * Abortable deadline for the complete mobile wallet load.
 * Extracted from wallet-data.ts per the 300-line ceiling (Codex
 * R94 P1): the load is several sequential Supabase round-trips
 * with no overall bound, and a stall left `useWallet` loading
 * forever while the mandatory purchase gate rejects every attempt.
 * Generic over the loader so tests need no Supabase mocks.
 */
export const WALLET_LOAD_TIMEOUT_MS = 30_000;

export function runWithWalletLoadDeadline<T>(
  load: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Wallet load timed out'));
    }, WALLET_LOAD_TIMEOUT_MS);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        signal?.reason instanceof Error
          ? signal.reason
          : new Error('Wallet load aborted')
      );
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    load().then(
      (data) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(data);
      },
      (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }
    );
  });
}

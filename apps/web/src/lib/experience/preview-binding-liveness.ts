import type { SupabaseClient } from '@supabase/supabase-js';

/** Liveness remains an anonymous, per-request RPC even for owner previews. */
export async function readPreviewBindingLiveness(
  client: SupabaseClient,
  binding: string,
  signal?: AbortSignal
) {
  const timeout = AbortSignal.timeout(5000);
  const deadline = signal ? AbortSignal.any([signal, timeout]) : timeout;
  deadline.throwIfAborted();
  const result = await client
    .rpc('experience_preview_binding_active', { p_binding: binding })
    .abortSignal(deadline);
  deadline.throwIfAborted();
  return !result.error && result.data === true;
}

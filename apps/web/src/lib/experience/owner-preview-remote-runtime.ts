import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

type RemoteOwnerPreview = (
  client: SupabaseClient,
  input: unknown
) => Promise<unknown>;
let installed: RemoteOwnerPreview | undefined;

/** Explicit trusted boot only; no environment discovery or implicit activation. */
export function installRemoteOwnerPreview(client: RemoteOwnerPreview) {
  if (installed) throw Error('REMOTE_OWNER_PREVIEW_ALREADY_INSTALLED');
  let active = true;
  const guarded: RemoteOwnerPreview = async (owner, input) => {
    if (!active) throw Error('REMOTE_OWNER_PREVIEW_UNAVAILABLE');
    const result = await client(owner, input);
    if (!active) throw Error('REMOTE_OWNER_PREVIEW_UNAVAILABLE');
    return result;
  };
  installed = guarded;
  return () => {
    active = false;
    if (installed === guarded) installed = undefined;
  };
}
export function getRemoteOwnerPreview() {
  return installed;
}

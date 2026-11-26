import { createClient } from '@supabase/supabase-js';
/** Dedicated linked-user bearer under existing RLS; never admin or cookie auth. */
export async function getLinkedUser(
  config: { url: string; anonKey: string; fetchImpl?: typeof fetch },
  accessToken: string,
  signal?: AbortSignal
) {
  const client = createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: signal
        ? (input, init) => {
            const requestSignal =
              init?.signal ?? (input instanceof Request ? input.signal : null);
            return (config.fetchImpl ?? fetch)(input, {
              ...init,
              signal: requestSignal
                ? AbortSignal.any([signal, requestSignal])
                : signal,
            });
          }
        : config.fetchImpl,
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('Reconnect Baci to continue.');
  return { actorUserId: data.user.id, client };
}
export async function getOwnedMerchant(
  config: { url: string; anonKey: string; fetchImpl?: typeof fetch },
  accessToken: string,
  actorUserId: string
) {
  const { actorUserId: verified, client } = await getLinkedUser(
    config,
    accessToken
  );
  if (verified !== actorUserId) throw new Error('Reconnect Baci to continue.');
  const { data, error } = await client
    .from('merchants')
    .select('id,business_name')
    .eq('user_id', actorUserId)
    .limit(2);
  if (error || data.length > 1)
    throw new Error('Unable to resolve Baci ownership.');
  return data[0] as { id: string; business_name: string | null } | undefined;
}

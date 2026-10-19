import type { SupabaseClient } from '@supabase/supabase-js';

const DISCOVERY_TTL_MS = 10 * 60 * 1000;

export function getJumiaSelfAuthorizationDiscoveryTtlMs(): number {
  return DISCOVERY_TTL_MS;
}

export async function createJumiaSelfAuthorizationDiscovery(
  supabase: SupabaseClient,
  args: {
    merchantId: string;
    clientKeyHash: string;
    credentialCiphertext: string;
  }
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabase.rpc(
      'create_jumia_self_authorization_discovery',
      {
        p_merchant_id: args.merchantId,
        p_client_key_hash: args.clientKeyHash,
        p_credential_ciphertext: args.credentialCiphertext,
      }
    );

    if (!error && typeof data === 'string' && data.length > 0) {
      return data;
    }
    lastError = error;
  }

  throw new Error('Failed to persist Jumia self-authorization discovery', {
    cause: lastError,
  });
}

export async function loadJumiaSelfAuthorizationDiscovery(
  supabase: SupabaseClient,
  args: {
    discoveryId: string;
    merchantId: string;
    clientKeyHash: string;
  }
): Promise<string | null> {
  const { data, error } = await supabase.rpc(
    'load_jumia_self_authorization_discovery',
    {
      p_discovery_id: args.discoveryId,
      p_merchant_id: args.merchantId,
      p_client_key_hash: args.clientKeyHash,
    }
  );

  if (error) {
    throw new Error('Failed to load Jumia self-authorization discovery');
  }

  return data ?? null;
}

export async function claimJumiaSelfAuthorizationDiscovery(
  supabase: SupabaseClient,
  args: {
    discoveryId: string;
    merchantId: string;
    clientKeyHash: string;
  }
): Promise<{ claimToken: string; credentialCiphertext: string } | null> {
  const { data, error } = await supabase.rpc(
    'claim_jumia_self_authorization_discovery',
    {
      p_discovery_id: args.discoveryId,
      p_merchant_id: args.merchantId,
      p_client_key_hash: args.clientKeyHash,
    }
  );

  if (error) {
    throw new Error('Failed to claim Jumia self-authorization discovery');
  }
  if (!(data && typeof data === 'object')) return null;

  const claimToken = Reflect.get(data, 'claim_token');
  const credentialCiphertext = Reflect.get(data, 'credential_ciphertext');
  return typeof claimToken === 'string' &&
    typeof credentialCiphertext === 'string'
    ? { claimToken, credentialCiphertext }
    : null;
}

export async function updateClaimedJumiaSelfAuthorizationDiscovery(
  supabase: SupabaseClient,
  args: {
    discoveryId: string;
    merchantId: string;
    claimToken: string;
    credentialCiphertext: string;
  }
): Promise<void> {
  const { data, error } = await supabase.rpc(
    'update_claimed_jumia_self_authorization_discovery',
    {
      p_discovery_id: args.discoveryId,
      p_merchant_id: args.merchantId,
      p_claim_token: args.claimToken,
      p_credential_ciphertext: args.credentialCiphertext,
    }
  );
  if (error || data !== true) {
    throw new Error('Failed to preserve rotated Jumia discovery credentials');
  }
}

/**
 * Preserve rotated credentials even when a claimed discovery update races its
 * expiry. A fresh discovery keeps the replacement token recoverable.
 */
export async function preserveJumiaSelfAuthorizationDiscoveryAfterRotation(
  supabase: SupabaseClient,
  args: {
    discoveryId?: string;
    merchantId: string;
    clientKeyHash: string;
    claimToken?: string;
    credentialCiphertext: string;
  }
): Promise<string | null> {
  if (args.discoveryId && args.claimToken) {
    try {
      await updateClaimedJumiaSelfAuthorizationDiscovery(supabase, {
        discoveryId: args.discoveryId,
        merchantId: args.merchantId,
        claimToken: args.claimToken,
        credentialCiphertext: args.credentialCiphertext,
      });
      return null;
    } catch {
      // Fall through to a fresh record so rotated credentials remain usable.
    }
  }
  return createJumiaSelfAuthorizationDiscovery(supabase, {
    merchantId: args.merchantId,
    clientKeyHash: args.clientKeyHash,
    credentialCiphertext: args.credentialCiphertext,
  });
}

export async function releaseJumiaSelfAuthorizationDiscovery(
  supabase: SupabaseClient,
  args: {
    discoveryId: string;
    merchantId: string;
    claimToken: string;
  }
): Promise<void> {
  const { data, error } = await supabase.rpc(
    'release_jumia_self_authorization_discovery',
    {
      p_discovery_id: args.discoveryId,
      p_merchant_id: args.merchantId,
      p_claim_token: args.claimToken,
    }
  );
  if (error || data !== true) {
    throw new Error('Failed to release Jumia self-authorization discovery');
  }
}

export async function consumeJumiaSelfAuthorizationDiscovery(
  supabase: SupabaseClient,
  args: {
    discoveryId: string;
    merchantId: string;
    clientKeyHash: string;
    claimToken: string;
  }
): Promise<string | null> {
  const { data, error } = await supabase.rpc(
    'consume_jumia_self_authorization_discovery',
    {
      p_discovery_id: args.discoveryId,
      p_merchant_id: args.merchantId,
      p_client_key_hash: args.clientKeyHash,
      p_claim_token: args.claimToken,
    }
  );

  if (error) {
    throw new Error('Failed to consume Jumia self-authorization discovery');
  }

  return data ?? null;
}

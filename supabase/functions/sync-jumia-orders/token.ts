import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { MarketplaceIntegration } from './types.ts';

export interface JumiaTokenConfig {
  apiBase: string;
  clientId: string;
  refreshBufferMs: number;
}

export async function refreshJumiaToken(
  supabase: SupabaseClient,
  integration: MarketplaceIntegration,
  config: JumiaTokenConfig
): Promise<string> {
  console.log(
    `[Jumia Sync] Refreshing token for integration ${integration.id}`
  );

  const response = await fetch(`${config.apiBase}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: integration.refresh_token,
      client_id: config.clientId,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const expiresAt = new Date(Date.now() + data.expires_in * 1000);

  const { error: updateError } = await supabase
    .from('marketplace_integrations')
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: expiresAt.toISOString(),
    })
    .eq('id', integration.id);

  if (updateError) {
    throw new Error(
      `Failed to persist refreshed token: ${updateError.message}`
    );
  }

  integration.access_token = data.access_token;
  integration.refresh_token = data.refresh_token;
  integration.token_expires_at = expiresAt.toISOString();

  return data.access_token;
}

export async function getValidJumiaToken(
  supabase: SupabaseClient,
  integration: MarketplaceIntegration,
  config: JumiaTokenConfig
): Promise<string> {
  if (integration.access_token && integration.token_expires_at) {
    const expiresAt = new Date(integration.token_expires_at);
    const bufferedExpiry = new Date(
      expiresAt.getTime() - config.refreshBufferMs
    );

    if (new Date() < bufferedExpiry) {
      return integration.access_token;
    }
  }

  return await refreshJumiaToken(supabase, integration, config);
}

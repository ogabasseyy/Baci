/**
 * Jumia Order Sync Edge Function
 * Cron job that polls Jumia for new orders and sends push notifications.
 *
 * Schedule: Every 5 minutes via Supabase cron.
 */

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { loadJumiaOrderSyncIntegrations } from './load-jumia-order-sync-integrations.ts';
import { processJumiaIntegration } from './process-integration.ts';

function requiredEnvironmentVariable(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} environment variable is required`);
  return value;
}

const SUPABASE_URL = requiredEnvironmentVariable('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = requiredEnvironmentVariable(
  'SUPABASE_SERVICE_ROLE_KEY'
);
const rawEnvironment = Deno.env.get('JUMIA_ENVIRONMENT') ?? 'production';
if (rawEnvironment !== 'staging' && rawEnvironment !== 'production') {
  throw new Error(
    `Invalid JUMIA_ENVIRONMENT: "${rawEnvironment}". Must be "staging" or "production".`
  );
}

const JUMIA_API_BASE =
  rawEnvironment === 'staging'
    ? 'https://vendor-api-staging.jumia.com'
    : 'https://vendor-api.jumia.com';
const JUMIA_CLIENT_ID = requiredEnvironmentVariable('JUMIA_CLIENT_ID');

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const MAX_PAGES = 100;
const tokenConfig = {
  apiBase: JUMIA_API_BASE,
  clientId: JUMIA_CLIENT_ID,
  refreshBufferMs: TOKEN_REFRESH_BUFFER_MS,
};
const ordersConfig = { apiBase: JUMIA_API_BASE, maxPages: MAX_PAGES };
const stockConfig = { apiBase: JUMIA_API_BASE };

function jsonResponse(
  body: Record<string, unknown>,
  status?: number
): Response {
  return new Response(JSON.stringify(body), {
    ...(status === undefined ? {} : { status }),
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (request) => {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.includes('Bearer')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  console.log('[Jumia Sync] Starting order sync job');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const integrations = await loadJumiaOrderSyncIntegrations(supabase);
    if (integrations.length === 0) {
      console.log('[Jumia Sync] No active integrations found');
      return jsonResponse({ message: 'No active integrations', synced: 0 });
    }

    console.log(`[Jumia Sync] Processing ${integrations.length} integrations`);
    let totalSynced = 0;
    let totalNewOrders = 0;
    const errors: string[] = [];

    for (const integration of integrations) {
      const result = await processJumiaIntegration({
        supabase,
        integration,
        tokenConfig,
        ordersConfig,
        stockConfig,
      });
      totalSynced += result.synced;
      totalNewOrders += result.newOrders;
      errors.push(...result.errors);
    }

    console.log(
      `[Jumia Sync] Completed: ${totalSynced} orders synced, ${totalNewOrders} new`
    );
    return jsonResponse({
      success: true,
      synced: totalSynced,
      newOrders: totalNewOrders,
      integrations: integrations.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('[Jumia Sync] Fatal error:', error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      500
    );
  }
});

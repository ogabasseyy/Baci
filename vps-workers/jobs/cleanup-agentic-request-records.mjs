/**
 * VPS worker: cleanup-agentic-request-records
 * Removes expired replay/outcome telemetry without adding work to agent routes.
 *
 * Required env vars (set in /home/bassey/baci-workers/.env):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Crontab: 10 * * * * flock -n /home/bassey/baci-workers/locks/cleanup-agentic-request-records.lock bash -lc 'cd /home/bassey/baci-workers && /usr/bin/node /home/bassey/baci-workers/jobs/cleanup-agentic-request-records.mjs' >> /home/bassey/baci-workers/logs/cleanup-agentic-request-records.log 2>&1
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { isEntrypoint } from '../lib/is-entrypoint.mjs';

const RETENTION_GRACE_MS = 60 * 60 * 1000;

export async function cleanupAgenticRequestRecords({
  createSupabaseClient = createClient,
  env = process.env,
  logger = console,
  now = new Date(),
} = {}) {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
    );
  }

  const cutoff = new Date(now.getTime() - RETENTION_GRACE_MS).toISOString();
  const supabase = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });
  const { error } = await supabase
    .from('agentic_request_records')
    .delete()
    .lt('expires_at', cutoff);

  if (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }

  logger.log(
    `[cleanup-agentic-request-records] Done - deleted rows with expires_at < ${cutoff}`
  );
  return { cutoff };
}

async function main() {
  config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

  try {
    await cleanupAgenticRequestRecords();
  } catch (error) {
    console.error('[cleanup-agentic-request-records] Worker failed:', error);
    process.exitCode = 1;
  }
}

if (
  isEntrypoint(import.meta.url)
) {
  await main();
}

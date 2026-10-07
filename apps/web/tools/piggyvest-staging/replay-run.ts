import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';
import z from 'zod';
import {
  createDurableReplayAdapters,
  createSupabaseRpc,
  type DurableReplayAdapterInput,
} from './replay-store';
import { createReplayWorker, type ReplayAdapters } from './replay-worker';

/**
 * Staging-only executable replay runner (NOT activated).
 *
 * Run with a TS runner that resolves the `react-server` condition, e.g.
 * from apps/web:
 *   node_modules/.bin/tsx --conditions=react-server \
 *     tools/piggyvest-staging/replay-run.ts --limit 10 --max-receipts 100
 *
 * Activation gates (all required, no defaults, no production fallback):
 * - PVB_STAGING_REPLAY_ENABLED=1
 * - PVB_STAGING_POSTGREST_URL: isolated staging PostgREST origin, which
 *   must be loopback or exactly listed in PVB_STAGING_ALLOWED_ORIGINS
 * - PVB_STAGING_WORKER_JWT: JWT whose role is pvb_staging_worker
 * - PVB_STAGING_APP_URL + PVB_STAGING_APP_KEY: mapping/ledger store
 *   (isolated staging origin, same allowlist rule; reviewed before activation)
 * - PVB_STAGING_ALLOWED_ORIGINS: comma-separated exact https origins;
 *   arbitrary https is refused even when it parses as a URL
 * - PVB_STAGING_RECEIPT_KEY_B64: 32-byte staging receipt key, base64
 * - PVB_STAGING_EXPECTED_SYSTEM_ID: receipt-store database identity pin
 * - PVB_STAGING_EXPECTED_APP_SYSTEM_ID: app database identity pin
 * - Refuses NODE_ENV=production unconditionally.
 *
 * The run is single-pass and bounded: it claims at most --max-receipts
 * in batches of --limit, then exits with a redacted summary (counts
 * only: no event bodies, balances, account numbers, or key material).
 * Exit 0 always means "pass finished"; check the summary counts for
 * retried/quarantined/resolutionFailures. Scheduling/daemonization and
 * the deployment review are separate gated steps.
 */

/**
 * Allowlist enforcement for staging origins. Arbitrary https is NOT
 * accepted: each origin must be loopback (rehearsal) or exactly match an
 * entry in PVB_STAGING_ALLOWED_ORIGINS (comma-separated `scheme://host[:port]`,
 * no paths). Comparison is on the parsed origin, so trailing slashes,
 * paths, credentials and case variants cannot smuggle a target past the list.
 */
export function isAllowedStagingOrigin(
  urlString: string,
  allowedOrigins: readonly string[]
): boolean {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  if (url.protocol === 'http:') {
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  }
  if (url.protocol !== 'https:') return false;
  const origin = url.origin.toLowerCase();
  return allowedOrigins.some((entry) => {
    try {
      return new URL(entry.trim()).origin.toLowerCase() === origin;
    } catch {
      return false;
    }
  });
}

function parseAllowedOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const envSchema = z.object({
  PVB_STAGING_REPLAY_ENABLED: z.literal('1'),
  PVB_STAGING_POSTGREST_URL: z.string().url(),
  PVB_STAGING_WORKER_JWT: z.string().min(1),
  PVB_STAGING_APP_URL: z.string().url(),
  PVB_STAGING_APP_KEY: z.string().min(1),
  PVB_STAGING_RECEIPT_KEY_B64: z.string().min(1),
  PVB_STAGING_ALLOWED_ORIGINS: z.string().optional(),
  PVB_STAGING_EXPECTED_SYSTEM_ID: z.string().regex(/^[0-9]{1,20}$/),
  PVB_STAGING_EXPECTED_APP_SYSTEM_ID: z.string().regex(/^[0-9]{1,20}$/),
  NODE_ENV: z.string().optional(),
});

export function parseReplayEnvironment(
  input: NodeJS.ProcessEnv = process.env
): z.infer<typeof envSchema> {
  return envSchema.parse(input);
}

function enforceStagingOrigins(env: z.infer<typeof envSchema>): void {
  const allowed = parseAllowedOrigins(env.PVB_STAGING_ALLOWED_ORIGINS);
  for (const [name, url] of [
    ['PVB_STAGING_POSTGREST_URL', env.PVB_STAGING_POSTGREST_URL],
    ['PVB_STAGING_APP_URL', env.PVB_STAGING_APP_URL],
  ] as const) {
    if (!isAllowedStagingOrigin(url, allowed)) {
      throw new Error(
        `Replay refuses ${name}: origin is not loopback and is not listed in PVB_STAGING_ALLOWED_ORIGINS`
      );
    }
  }
}

export function assertSystemIdentifier(
  actual: unknown,
  expected: string,
  expectedEnvName = 'PVB_STAGING_EXPECTED_SYSTEM_ID'
): void {
  if (typeof actual !== 'string' || actual.trim() !== expected) {
    throw new Error(
      `Replay refuses: connected database identity does not match ${expectedEnvName}`
    );
  }
}

const SYSTEM_IDENTIFIER_RPC = 'piggyvest_staging_system_id';

async function readSystemIdentifier(client: SupabaseClient): Promise<unknown> {
  try {
    const { data, error } = await client.rpc(SYSTEM_IDENTIFIER_RPC);
    if (error) throw new Error('RPC failed');
    return data;
  } catch {
    throw new Error('database identity RPC failed');
  }
}

export async function validateReplayDatabaseIdentities(
  receiptClient: SupabaseClient,
  appClient: SupabaseClient,
  expectedReceiptSystemId: string,
  expectedAppSystemId: string
): Promise<void> {
  const [receiptResult, appResult] = await Promise.allSettled([
    readSystemIdentifier(receiptClient),
    readSystemIdentifier(appClient),
  ]);

  if (receiptResult.status === 'rejected') {
    throw new Error(
      'Replay refuses: receipt database identity validation failed'
    );
  }
  if (appResult.status === 'rejected') {
    throw new Error('Replay refuses: app database identity validation failed');
  }

  assertSystemIdentifier(receiptResult.value, expectedReceiptSystemId);
  assertSystemIdentifier(
    appResult.value,
    expectedAppSystemId,
    'PVB_STAGING_EXPECTED_APP_SYSTEM_ID'
  );
}

const argsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(10),
  maxReceipts: z.number().int().min(1).max(1000).default(100),
  leaseSeconds: z.number().int().min(30).max(3600).default(300),
});

function parseArgs(argv: string[]): z.infer<typeof argsSchema> {
  const raw: Record<string, number> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = Number(argv[i + 1]);
    if (flag === '--limit') raw.limit = value;
    else if (flag === '--max-receipts') raw.maxReceipts = value;
    else if (flag === '--lease-seconds') raw.leaseSeconds = value;
    else throw new Error(`Unknown replay flag: ${flag}`);
  }
  return argsSchema.parse(raw);
}

async function main(
  options: {
    env?: NodeJS.ProcessEnv;
    argv?: string[];
    receiptFetch?: typeof fetch;
    appFetch?: typeof fetch;
    allowLegacyInflow?: DurableReplayAdapterInput['allowLegacyInflow'];
    dispatchFinancial?: ReplayAdapters['dispatchFinancial'];
    accrualReplay?: DurableReplayAdapterInput['accrualReplay'];
    prefundedReplay?: ReplayAdapters['prefundedReplay'];
  } = {}
) {
  if (
    process.env.NODE_ENV === 'production' ||
    options.env?.NODE_ENV === 'production'
  ) {
    throw new Error('Replay runner refuses NODE_ENV=production');
  }
  const env = parseReplayEnvironment(options.env);
  enforceStagingOrigins(env);
  const args = parseArgs(options.argv ?? process.argv.slice(2));

  const key = Buffer.from(env.PVB_STAGING_RECEIPT_KEY_B64, 'base64');
  if (key.length !== 32) {
    throw new Error('Replay receipt key must decode to 32 bytes');
  }

  const storeClient = createClient(
    env.PVB_STAGING_POSTGREST_URL,
    env.PVB_STAGING_WORKER_JWT,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: options.receiptFetch },
    }
  );
  const appClient = createClient(
    env.PVB_STAGING_APP_URL,
    env.PVB_STAGING_APP_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: options.appFetch },
    }
  );

  await validateReplayDatabaseIdentities(
    storeClient,
    appClient,
    env.PVB_STAGING_EXPECTED_SYSTEM_ID,
    env.PVB_STAGING_EXPECTED_APP_SYSTEM_ID
  );

  const adapters = createDurableReplayAdapters({
    prefundedReplay: options.prefundedReplay,
    allowLegacyInflow: options.allowLegacyInflow,
    dispatchFinancial: options.dispatchFinancial,
    accrualReplay: options.accrualReplay,
    store: createSupabaseRpc(storeClient),
    app: appClient,
    keyResolver: async (keyVersion) =>
      keyVersion === 'staging-v1' ? key : null,
    leaseSeconds: args.leaseSeconds,
  });
  const worker = createReplayWorker(adapters, {
    environment: 'staging',
    batchSize: args.limit,
    keyResolver: async (keyVersion) =>
      keyVersion === 'staging-v1' ? key : null,
  });

  const totals = {
    claimed: 0,
    processed: 0,
    quarantined: 0,
    retryable: 0,
    resolutionFailures: 0,
  };
  for (let done = 0; done < args.maxReceipts; done += args.limit) {
    const result = await worker.run();
    totals.claimed += result.claimed;
    totals.processed += result.processed;
    totals.quarantined += result.quarantined;
    totals.retryable += result.retryable;
    totals.resolutionFailures += result.resolutionFailures;
    if (result.claimed === 0) break;
  }
  console.log(JSON.stringify({ replay: 'staging-pass-complete', ...totals }));
  return totals;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('replay-run.ts');

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(
      JSON.stringify({
        replay: 'staging-pass-failed',
        message: error instanceof Error ? error.message : 'unknown',
      })
    );
    process.exitCode = 1;
  });
}

export { main as runReplayPass };

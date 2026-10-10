import 'server-only';

import { createClient } from '@supabase/supabase-js';
import type { BlogMediaSweepClient } from '@/app/api/admin/blog/upload/blog-media-tombstone-sweep';
import type { Database } from '@/types/supabase';

export class BlogMediaSweepWorkerTokenError extends Error {}

// The worker JWT travels in the Authorization header, so a mistyped
// or substituted URL would exfiltrate it to an origin that can replay
// it against the real endpoint. BLOG_MEDIA_SWEEP_SUPABASE_ORIGIN_ALLOWLIST
// (comma-separated hostnames, no scheme or port) EXTENDS this pin for
// preview, local, and test origins — it can only add origins, never
// remove the pin — and only when NODE_ENV is not production.
const EXPECTED_WORKER_ROLE = 'blog_media_sweep_worker';
const EXPECTED_SUPABASE_HOST = 'aivqthbxdshhltbwipbr.supabase.co';

const RESTRICTED_RPC_NAMES: Readonly<Record<string, string>> = {
  claim_sweepable_blog_media_tombstones: 'blog_media_sweep_worker_claim',
  delete_claimed_blog_media_tombstones: 'blog_media_sweep_worker_release',
};

const SUPPORTED_SIGNING_ALGORITHMS = new Set(['ES256', 'HS256', 'RS256']);

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '');
}

function parseJwtPart(token: string, index: number): Record<string, unknown> {
  const value = token.split('.')[index];
  if (!value) throw new Error('JWT part is missing');
  const parsed: unknown = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8')
  );
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JWT part is invalid');
  }
  return parsed as Record<string, unknown>;
}

// Expiry/role pre-check only: it never verifies the JWT signature or
// issuer. A mis-issued token surfaces at PostgREST; this check only
// refuses to build a client that cannot possibly hold the capability.
function hasCurrentWorkerCapability(token: string): boolean {
  try {
    if (token.split('.').length !== 3) return false;
    const header = parseJwtPart(token, 0);
    const claims = parseJwtPart(token, 1);
    return (
      typeof header.alg === 'string' &&
      SUPPORTED_SIGNING_ALGORITHMS.has(header.alg) &&
      claims.role === EXPECTED_WORKER_ROLE &&
      typeof claims.exp === 'number' &&
      claims.exp * 1000 > Date.now()
    );
  } catch {
    return false;
  }
}

/**
 * Creates the two-operation PostgREST capability used by the tombstone
 * cleanup cron: the claim/release wrapper RPCs plus Storage removal
 * confined to the media bucket. Postgres confines the rest — the
 * worker role holds EXECUTE only on the wrappers and a DELETE policy
 * only on claimed media/platform/blog/* tombstones. Throws on any
 * invalid setup so the cron fails closed until
 * BLOG_MEDIA_SWEEP_WORKER_TOKEN is provisioned.
 */
export function createBlogMediaSweepWorkerClient(
  env: Readonly<Record<string, string | undefined>>
): BlogMediaSweepClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const workerToken = env.BLOG_MEDIA_SWEEP_WORKER_TOKEN?.trim();
  if (!workerToken || !hasCurrentWorkerCapability(workerToken)) {
    throw new BlogMediaSweepWorkerTokenError(
      'Blog media sweep worker capability is invalid'
    );
  }
  if (!url || !anonKey) {
    throw new BlogMediaSweepWorkerTokenError(
      'Blog media sweep worker capability is invalid'
    );
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new BlogMediaSweepWorkerTokenError(
      'Blog media sweep worker capability is invalid'
    );
  }
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username !== '' ||
    parsedUrl.password !== ''
  ) {
    throw new Error(
      'Blog media sweep worker Supabase URL must be a credential-free https:// URL'
    );
  }
  const originAllowlist =
    (env.NODE_ENV ?? '').trim().toLowerCase() === 'production'
      ? ''
      : (env.BLOG_MEDIA_SWEEP_SUPABASE_ORIGIN_ALLOWLIST ?? '');
  const allowedOrigins = new Set(
    originAllowlist
      .split(',')
      .map((entry) => normalizeHostname(entry))
      .filter((entry) => entry !== '')
  );
  allowedOrigins.add(EXPECTED_SUPABASE_HOST);
  if (!allowedOrigins.has(normalizeHostname(parsedUrl.hostname))) {
    throw new Error(
      'Blog media sweep worker Supabase URL host is not an allowed origin'
    );
  }

  const client = createClient<Database>(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { Authorization: `Bearer ${workerToken}` } },
  });
  const rpc = (
    client as unknown as {
      rpc: (
        functionName: never,
        args?: never,
        options?: Record<string, unknown>
      ) => unknown;
    }
  ).rpc.bind(client);
  const storage = client.storage;
  const restrictedRpc = (
    functionName: string,
    args?: Record<string, unknown>
  ) => {
    const restrictedName = RESTRICTED_RPC_NAMES[functionName];
    if (!restrictedName) {
      throw new Error('Unsupported blog media sweep database operation');
    }
    return rpc(restrictedName as never, args as never);
  };
  const restrictedStorage = {
    from: (bucket: string) => {
      if (bucket !== 'media') {
        throw new Error('Unsupported blog media sweep storage bucket');
      }
      return storage.from(bucket);
    },
  };
  return {
    rpc: restrictedRpc,
    storage: restrictedStorage,
  } as unknown as BlogMediaSweepClient;
}

import 'server-only';

import { createClient } from '@supabase/supabase-js';

const ROLE = 'immediate_notification_redrive';
const HOST = 'aivqthbxdshhltbwipbr.supabase.co';
const RPCS: ReadonlySet<string> = new Set([
  'begin_immediate_notification_dispatch',
  'record_immediate_notification_acceptance',
  'release_immediate_notification_dispatch',
  'recover_immediate_notification_completion',
  'list_immediate_notification_recovery_candidates',
  'has_immediate_notification_reconciliation_backlog',
]);

function isCurrentWorkerToken(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) return false;
    const header: unknown = JSON.parse(
      Buffer.from(parts[0], 'base64url').toString('utf8')
    );
    const payload: unknown = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    );
    if (
      !header ||
      typeof header !== 'object' ||
      !payload ||
      typeof payload !== 'object'
    )
      return false;
    const h = header as Record<string, unknown>;
    const p = payload as Record<string, unknown>;
    return (
      ['ES256', 'RS256', 'HS256'].includes(String(h.alg)) &&
      p.role === ROLE &&
      typeof p.exp === 'number' &&
      p.exp * 1000 > Date.now()
    );
  } catch {
    return false;
  }
}

/** Server-only narrow client. PostgREST must independently verify the JWT and scope hook. */
export function createImmediateNotificationRedriveClient(
  env: Readonly<Record<string, string | undefined>>
) {
  const token = env.IMMEDIATE_NOTIFICATION_REDRIVE_WORKER_TOKEN?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  let url: URL;
  try {
    url = new URL(env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '');
  } catch {
    throw new Error('Immediate notification redrive capability is invalid');
  }
  if (
    !token ||
    !isCurrentWorkerToken(token) ||
    !key ||
    url.protocol !== 'https:' ||
    url.hostname !== HOST ||
    url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Immediate notification redrive capability is invalid');
  }
  const client = createClient(url.toString(), key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return {
    rpc(name: string, args: Record<string, unknown>) {
      if (!RPCS.has(name))
        throw new Error('Unsupported immediate notification redrive operation');
      return client.rpc(name, args);
    },
  };
}

const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Returns the configured Cloudflare Quiz Edge Worker base URL, or `undefined`
 * when unset/blank or invalid (requires `https:` outside localhost).
 */
export function getQuizEdgeWorkerUrl(): string | undefined {
  const raw = process.env.QUIZ_EDGE_WORKER_URL?.trim();
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.search || parsed.hash) {
      return undefined;
    }
    if (
      parsed.protocol === 'https:' ||
      (parsed.protocol === 'http:' && LOCALHOST_HOSTS.has(parsed.hostname))
    ) {
      return raw.replace(/\/+$/, '');
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns the server-side HMAC ticket signing secret for Cloudflare Edge Quiz
 * Rooms, or `undefined` when unset/blank.
 */
export function getQuizTicketSecret(): string | undefined {
  const raw = process.env.QUIZ_TICKET_SECRET?.trim();
  return raw ? raw : undefined;
}

/**
 * Returns the shared bearer secret used by `apps/web` to invoke internal
 * coordinator/admin endpoints (`/api/quiz/admin/init-rooms`, `/heartbeat`)
 * on the Cloudflare Quiz Edge Worker, or `undefined` when unset/blank.
 */
export function getQuizInternalCoordinatorSecret(): string | undefined {
  const raw = process.env.QUIZ_INTERNAL_COORDINATOR_SECRET?.trim();
  return raw ? raw : undefined;
}

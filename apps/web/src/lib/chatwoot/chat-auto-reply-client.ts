import 'server-only';

import { conversationSnapshotSchema } from '@/schemas/chat-auto-reply';
import type { ChatAutoReplyBinding } from './chat-auto-reply-config';

const REQUEST_TIMEOUT_MS = 5_000;

/** The HTTP status, or null when the request never completed. */
async function providerPostStatus(
  binding: ChatAutoReplyBinding,
  path: string,
  token: string,
  body: Record<string, unknown>
): Promise<number | null> {
  const url = new URL(
    `/api/v1/accounts/${binding.accountId}${path}`,
    binding.apiOrigin
  );
  try {
    const response = await fetch(url, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        api_access_token: token,
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Status only: never the token, message text or response body.
      console.error('[chat-auto-reply] provider request failed', {
        status: response.status,
        path: path.replace(/\/\d+/g, '/:id'),
      });
    }
    return response.status;
  } catch {
    console.error('[chat-auto-reply] provider request failed', {
      status: null,
      path: path.replace(/\/\d+/g, '/:id'),
    });
    return null;
  }
}

const isOk = (status: number | null) =>
  status !== null && status >= 200 && status < 300;

async function providerPost(
  binding: ChatAutoReplyBinding,
  path: string,
  token: string,
  body: Record<string, unknown>
): Promise<boolean> {
  return isOk(await providerPostStatus(binding, path, token, body));
}

/** Posts as the assistant bot: a public reply, or a private staff note. */
export function postAssistantMessage(
  binding: ChatAutoReplyBinding,
  input: { conversationId: number; content: string; isPrivate?: boolean }
): Promise<boolean> {
  return providerPost(
    binding,
    `/conversations/${input.conversationId}/messages`,
    binding.botApiAccessToken,
    {
      content: input.content,
      message_type: 'outgoing',
      private: input.isPrivate === true,
    }
  );
}

/**
 * Moves a conversation to a person's queue (`open`) or back (`pending`). The
 * bot credential goes first; only when it is refused (401 or 403: expired or
 * revoked) is the inbox credential tried, so a handover caused by a dead bot
 * credential can still reach a person. A timeout or server error is not
 * retried: the first request may have landed, and staff may have acted since.
 */
export async function setConversationStatus(
  binding: ChatAutoReplyBinding,
  input: { conversationId: number; status: 'open' | 'pending' }
): Promise<boolean> {
  const path = `/conversations/${input.conversationId}/toggle_status`;
  const body = { status: input.status };
  const status = await providerPostStatus(
    binding,
    path,
    binding.botApiAccessToken,
    body
  );
  if (status !== 401 && status !== 403) return isOk(status);
  return providerPost(binding, path, binding.apiAccessToken, body);
}

/** Replaces the conversation's whole label list (merge before calling). */
export function setConversationLabels(
  binding: ChatAutoReplyBinding,
  input: { conversationId: number; labels: string[] }
): Promise<boolean> {
  return providerPost(
    binding,
    `/conversations/${input.conversationId}/labels`,
    binding.apiAccessToken,
    { labels: input.labels }
  );
}

export type ConversationSnapshot = { status: string; labels: string[] };

/**
 * The conversation's live status and labels. A webhook snapshot can be stale
 * by the time the assistant acts, so decisions that must not talk over a
 * person or drop a label read this first. Null when it cannot be read.
 */
export async function getConversationSnapshot(
  binding: ChatAutoReplyBinding,
  conversationId: number
): Promise<ConversationSnapshot | null> {
  const path = `/conversations/${conversationId}`;
  const url = new URL(
    `/api/v1/accounts/${binding.accountId}${path}`,
    binding.apiOrigin
  );
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        api_access_token: binding.apiAccessToken,
      },
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error('[chat-auto-reply] provider request failed', {
        status: response.status,
        path: '/conversations/:id',
      });
      return null;
    }
    const parsed = conversationSnapshotSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    console.error('[chat-auto-reply] provider request failed', {
      status: null,
      path: '/conversations/:id',
    });
    return null;
  }
}

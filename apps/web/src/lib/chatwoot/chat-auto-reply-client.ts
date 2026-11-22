import 'server-only';

import { conversationSnapshotSchema } from '@/schemas/chat-auto-reply';
import type { ChatAutoReplyBinding } from './chat-auto-reply-config';

const REQUEST_TIMEOUT_MS = 5_000;

async function providerPost(
  binding: ChatAutoReplyBinding,
  path: string,
  token: string,
  body: Record<string, unknown>
): Promise<boolean> {
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
    return response.ok;
  } catch {
    console.error('[chat-auto-reply] provider request failed', {
      status: null,
      path: path.replace(/\/\d+/g, '/:id'),
    });
    return false;
  }
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
 * bot credential goes first; when it is refused (expired or revoked) the
 * inbox credential is tried, so a handover caused by a dead bot credential
 * can still reach a person.
 */
export async function setConversationStatus(
  binding: ChatAutoReplyBinding,
  input: { conversationId: number; status: 'open' | 'pending' }
): Promise<boolean> {
  const path = `/conversations/${input.conversationId}/toggle_status`;
  const body = { status: input.status };
  if (await providerPost(binding, path, binding.botApiAccessToken, body)) {
    return true;
  }
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

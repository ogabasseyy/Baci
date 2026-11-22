import 'server-only';

import {
  type MerchantInboxConversation,
  providerInboxConversationSchema,
} from '@/schemas/merchant-inbox';
import type { MerchantInboxUpdate } from '@/schemas/merchant-inbox-manage';
import {
  failure,
  getMerchantInboxConversation,
  type MerchantInboxFailure,
  providerGet,
} from './merchant-inbox-client';
import type { MerchantInboxBinding } from './merchant-inbox-config';
import { applyInboxLabelChange } from './merchant-inbox-labels';

const REQUEST_TIMEOUT_MS = 8_000;

async function providerPost(
  binding: MerchantInboxBinding,
  path: string,
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
        api_access_token: binding.apiAccessToken,
      },
      body: JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      // Status only: never the token or the response body.
      console.error('[merchant-inbox] provider write failed', {
        status: response.status,
        path: path.replace(/\/\d+/g, '/:id'),
      });
    }
    return response.ok;
  } catch {
    console.error('[merchant-inbox] provider write failed', {
      status: null,
      path: path.replace(/\/\d+/g, '/:id'),
    });
    return false;
  }
}

const unavailable: MerchantInboxFailure = { ok: false, code: 'unavailable' };

/**
 * Applies one change to a conversation of the bound inbox: Done / reopen,
 * follow-up (snooze), priority and tags. The conversation is read first, so
 * an id from another store's inbox is a plain "not found", and the label list
 * is merged from the live labels (the provider replaces the whole list).
 */
export async function updateMerchantInboxConversation(
  binding: MerchantInboxBinding,
  input: {
    conversationId: number;
    update: MerchantInboxUpdate;
    now?: number;
  }
): Promise<
  | { ok: true; conversation: MerchantInboxConversation }
  | MerchantInboxFailure
  | { ok: false; code: 'invalid_follow_up' }
> {
  const { conversationId, update } = input;
  const owned = await getMerchantInboxConversation(binding, conversationId);
  if (!owned.ok) return owned;

  const base = `/conversations/${conversationId}`;
  const followUpAt = update.followUpAt;
  let followUp: boolean | undefined;

  if (update.status === 'resolved') {
    if (
      !(await providerPost(binding, `${base}/toggle_status`, {
        status: 'resolved',
      }))
    )
      return unavailable;
    followUp = false;
  } else if (typeof followUpAt === 'string') {
    const at = Date.parse(followUpAt);
    const nowMs = input.now ?? Date.now();
    if (Number.isNaN(at) || at <= nowMs || at - nowMs > 90 * 86_400_000) {
      return { ok: false, code: 'invalid_follow_up' };
    }
    if (
      !(await providerPost(binding, `${base}/toggle_status`, {
        status: 'snoozed',
        snoozed_until: Math.floor(at / 1000),
      }))
    ) {
      return unavailable;
    }
    followUp = true;
  } else if (update.status === 'open' || followUpAt === null) {
    if (
      owned.conversation.status !== 'open' &&
      !(await providerPost(binding, `${base}/toggle_status`, {
        status: 'open',
      }))
    ) {
      return unavailable;
    }
    if (followUpAt === null) followUp = false;
  }

  if (update.priority !== undefined) {
    if (
      !(await providerPost(binding, `${base}/toggle_priority`, {
        priority: update.priority,
      }))
    )
      return unavailable;
  }

  const tagsChange =
    (update.addTags?.length ?? 0) > 0 || (update.removeTags?.length ?? 0) > 0;
  if (tagsChange || followUp !== undefined) {
    const live = await providerGet(binding, base);
    if (!live.ok) return failure(live);
    const parsed = providerInboxConversationSchema.safeParse(live.body);
    if (!parsed.success) return unavailable;
    const labels = applyInboxLabelChange(parsed.data.labels ?? [], {
      addTags: update.addTags,
      removeTags: update.removeTags,
      followUp,
    });
    if (!(await providerPost(binding, `${base}/labels`, { labels }))) {
      return unavailable;
    }
  }

  const fresh = await getMerchantInboxConversation(binding, conversationId);
  return fresh.ok ? fresh : unavailable;
}

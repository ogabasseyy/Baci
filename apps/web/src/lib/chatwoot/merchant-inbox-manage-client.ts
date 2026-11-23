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
 * Reads the live labels, applies the change and writes the whole list back
 * (the provider replaces it). The engine has no conditional update, so two
 * writers changing one chat's labels in the same instant can overwrite each
 * other; the app always shows the labels the engine returns afterwards.
 * Returns the failure, or null when the labels were saved.
 */
async function writeLabels(
  binding: MerchantInboxBinding,
  base: string,
  change: Parameters<typeof applyInboxLabelChange>[1]
): Promise<MerchantInboxFailure | null> {
  const live = await providerGet(binding, base);
  if (!live.ok) return failure(live);
  const parsed = providerInboxConversationSchema.safeParse(live.body);
  if (!parsed.success) return unavailable;
  const labels = applyInboxLabelChange(parsed.data.labels ?? [], change);
  return (await providerPost(binding, `${base}/labels`, { labels }))
    ? null
    : unavailable;
}

/** After a snooze whose answer did not arrive: did the engine apply it anyway? */
async function snoozeOutcome(
  binding: MerchantInboxBinding,
  conversationId: number,
  atMs: number
): Promise<'applied' | 'not_applied' | 'unknown'> {
  const check = await getMerchantInboxConversation(binding, conversationId);
  if (!check.ok) return 'unknown';
  const until = check.conversation.snoozedUntil
    ? Date.parse(check.conversation.snoozedUntil)
    : Number.NaN;
  return check.conversation.status === 'snoozed' &&
    until === Math.floor(atMs / 1000) * 1000
    ? 'applied'
    : 'not_applied';
}

/**
 * Applies one change to a conversation of the bound inbox: Done / reopen,
 * follow-up (snooze), priority and tags. The conversation is read first, so
 * an id from another store's inbox is a plain "not found", and the label list
 * is merged from the live labels (the provider replaces the whole list).
 *
 * A request that changes several things at once (say a follow-up and a
 * priority) is several writes and is not transactional: if a later one fails
 * the earlier ones stay applied and the caller gets `unavailable`. Repeating
 * the request re-applies them without harm (a follow-up time that has passed
 * in the meantime is refused before anything is written), and the app sends
 * one change per request.
 *
 * A follow-up is two writes, the label and the snooze. The label goes first:
 * a chat snoozed without it would vanish from the Follow-up view, while a
 * label without the snooze still shows, and is taken off again if the snooze
 * fails.
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
  const tagChange = { addTags: update.addTags, removeTags: update.removeTags };
  let followUp: boolean | undefined;
  let labelsSaved = false;

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
    const labelled = await writeLabels(binding, base, {
      ...tagChange,
      followUp: true,
    });
    if (labelled) return labelled;
    labelsSaved = true;
    if (
      !(await providerPost(binding, `${base}/toggle_status`, {
        status: 'snoozed',
        snoozed_until: Math.floor(at / 1000),
      }))
    ) {
      // No answer is not the same as "not snoozed": the engine may have
      // applied it and the reply got lost. Look before undoing anything.
      const outcome = await snoozeOutcome(binding, conversationId, at);
      if (outcome !== 'applied') {
        // Only a snooze that is clearly absent takes the label back off, and
        // not when the chat already had a follow-up (its earlier snooze and
        // label still agree). If we cannot tell, the label stays: a chat that
        // shows in the Follow-up view is better than one that vanished.
        if (outcome === 'not_applied' && !owned.conversation.followUp) {
          await writeLabels(binding, base, { followUp: false });
        }
        return unavailable;
      }
    }
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
  if (!labelsSaved && (tagsChange || followUp !== undefined)) {
    const failed = await writeLabels(binding, base, { ...tagChange, followUp });
    if (failed) return failed;
  }

  const fresh = await getMerchantInboxConversation(binding, conversationId);
  return fresh.ok ? fresh : unavailable;
}

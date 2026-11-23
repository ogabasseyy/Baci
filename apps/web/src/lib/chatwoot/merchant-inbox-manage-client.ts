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

/**
 * How a write ended. `rejected`: the engine answered with a client error, so
 * it certainly did not apply it. `unknown`: no usable answer (timeout, network
 * error, a server error), so it may have been applied, or may still be.
 */
type WriteOutcome = 'ok' | 'rejected' | 'unknown';

async function providerWrite(
  binding: MerchantInboxBinding,
  path: string,
  body: Record<string, unknown>
): Promise<WriteOutcome> {
  const url = new URL(
    `/api/v1/accounts/${binding.accountId}${path}`,
    binding.apiOrigin
  );
  const logFailure = (status: number | null) =>
    // Status only: never the token or the response body.
    console.error('[merchant-inbox] provider write failed', {
      status,
      path: path.replace(/\/\d+/g, '/:id'),
    });
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
    if (response.ok) return 'ok';
    logFailure(response.status);
    const refused =
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408;
    return refused ? 'rejected' : 'unknown';
  } catch {
    logFailure(null);
    return 'unknown';
  }
}

async function providerPost(
  binding: MerchantInboxBinding,
  path: string,
  body: Record<string, unknown>
): Promise<boolean> {
  return (await providerWrite(binding, path, body)) === 'ok';
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

/**
 * The engine may round or shift a snooze by a few seconds, so a time this close
 * to the requested one counts as the same snooze; a different hour is another.
 */
const SNOOZE_MATCH_TOLERANCE_MS = 60_000;

/** After a snooze with no clear answer: does the engine show it as applied? */
async function snoozeApplied(
  binding: MerchantInboxBinding,
  conversationId: number,
  atMs: number
): Promise<boolean> {
  const check = await getMerchantInboxConversation(binding, conversationId);
  if (!check.ok) return false;
  const until = check.conversation.snoozedUntil
    ? Date.parse(check.conversation.snoozedUntil)
    : Number.NaN;
  return (
    check.conversation.status === 'snoozed' &&
    Math.abs(until - atMs) <= SNOOZE_MATCH_TOLERANCE_MS
  );
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
    const snooze = await providerWrite(binding, `${base}/toggle_status`, {
      status: 'snoozed',
      snoozed_until: Math.floor(at / 1000),
    });
    if (snooze === 'rejected') {
      // The engine refused, so nothing is snoozed: take the label back off,
      // unless the chat already had a follow-up (its earlier snooze and label
      // still agree).
      if (!owned.conversation.followUp) {
        await writeLabels(binding, base, { followUp: false });
      }
      return unavailable;
    }
    // No clear answer (timeout, server error): the snooze may have been
    // applied, or may still land after any check made now, so the label is
    // never taken back off; a chat that shows in the Follow-up view beats one
    // that vanished. If the engine shows it as snoozed, carry on.
    if (
      snooze === 'unknown' &&
      !(await snoozeApplied(binding, conversationId, at))
    ) {
      return unavailable;
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
    // Either way no follow-up is pending any more (reopening cancels a snooze),
    // so a leftover label, say on a chat resolved outside the app, goes too.
    if (followUpAt === null || owned.conversation.followUp) followUp = false;
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

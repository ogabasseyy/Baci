import type { ExpoPushMessage } from 'expo-server-sdk';
import { logger } from '@/lib/logger';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  type NotificationSendResult,
  processTickets,
  recordPushAttempt,
  sendPushNotifications,
} from './expo-push';
import { preparePushNotificationPayload } from './prepare-push-notification-payload';

const UPDATE_NUDGE_STAMP_CHUNK_SIZE = 100;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

const DEFAULT_UPDATE_NUDGE_THROTTLE_DAYS = 7;

export interface StorefrontUpdateNudgeParams {
  /** Which app's installs to nudge (push_tokens.app_type). Defaults to storefront. */
  appType?: 'storefront' | 'admin';
  platform: 'android' | 'ios';
  /** Latest published native build (Android versionCode / iOS CFBundleVersion). */
  latestBuild: number;
  storeUrl?: string | null;
  title?: string;
  body?: string;
  /** Don't re-nudge a device pinged within this many days. */
  throttleDays?: number;
  /** Cap recipients per run; the daily cadence + throttle drains any backlog. */
  limit?: number;
  /** Injectable clock for tests. */
  now?: Date;
}

const DEFAULT_UPDATE_NUDGE_LIMIT = 5000;

export interface StorefrontUpdateNudgeResult extends NotificationSendResult {
  platform: 'android' | 'ios';
  /** Tokens processed this run — capped at `limit`, NOT the true eligible total. */
  eligible: number;
  /**
   * True when this run hit the per-run `limit`, i.e. a backlog likely remains
   * and the next run will drain more. Lets operators detect backlog from the
   * cron output instead of misreading a capped `eligible` as "all done".
   */
  cappedAtLimit: boolean;
  /**
   * True when a `last_update_push_at` write failed for at least one chunk. Those
   * devices keep their old (or null) throttle timestamp, so they stay eligible
   * and would be re-nudged — surface it so the caller can alert/retry instead of
   * silently defeating the throttle.
   */
  stampFailed: boolean;
}

/**
 * Push a "new version available" notification to active storefront installs on
 * an older build than `latestBuild`. Tokens with an unknown build_number (NULL —
 * registered by an app version predating build tracking) are treated as
 * outdated so existing installs are still reached, self-correcting once the
 * device re-registers with its real build. Each device is throttled to one
 * nudge per `throttleDays`. The payload type `mobile_update_available` is
 * handled client-side: tapping opens the in-app update prompt (which links to
 * the store), so users already on the latest build simply see no prompt.
 */
export async function notifyStorefrontUpdateAvailable(
  params: StorefrontUpdateNudgeParams
): Promise<StorefrontUpdateNudgeResult> {
  const {
    appType = 'storefront',
    platform,
    latestBuild,
    storeUrl = null,
    throttleDays = DEFAULT_UPDATE_NUDGE_THROTTLE_DAYS,
    limit = DEFAULT_UPDATE_NUDGE_LIMIT,
    now = new Date(),
    title = 'Update available',
    body = 'A new version is ready — tap to update.',
  } = params;

  const supabase = createAdminClient();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(
    now.getTime() - throttleDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const data = preparePushNotificationPayload({
    type: 'mobile_update_available',
    platform,
    storeUrl,
  });

  const recordSkip = async (
    result: StorefrontUpdateNudgeResult
  ): Promise<StorefrontUpdateNudgeResult> => {
    await recordPushAttempt(supabase, {
      appType,
      channel: 'general',
      notificationType: 'mobile_update_available',
      title,
      body,
      payload: data,
      tokenCount: 0,
      result,
    });
    return result;
  };

  // Active storefront tokens for this platform, on an older (or unknown) build,
  // not nudged within the throttle window. Two .or() groups are AND-combined.
  const { data: tokens, error } = await supabase
    .from('push_tokens')
    .select('id, token')
    .eq('app_type', appType)
    .eq('platform', platform)
    .eq('is_active', true)
    // Eligibility:
    //   (build_number IS NULL OR build_number < latest)
    //   AND (last_update_push_at IS NULL OR last_update_push_at < cutoff)
    // Chaining two .or() calls does NOT AND them — PostgREST's `or` param gets
    // overwritten, silently dropping the build filter. Express it as a single
    // OR-of-ANDs (DNF) so both conditions are guaranteed to apply.
    .or(
      [
        'and(build_number.is.null,last_update_push_at.is.null)',
        `and(build_number.is.null,last_update_push_at.lt.${cutoffIso})`,
        `and(build_number.lt.${latestBuild},last_update_push_at.is.null)`,
        `and(build_number.lt.${latestBuild},last_update_push_at.lt.${cutoffIso})`,
      ].join(',')
    )
    // Never-nudged (NULL) first, then oldest-stamped. Without this ordering the
    // capped query could keep returning re-eligible rows and starve the
    // never-nudged backlog when the eligible set exceeds limit * throttleDays.
    .order('last_update_push_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (error) {
    return recordSkip({
      sent: 0,
      failed: 0,
      errors: [error.message],
      platform,
      eligible: 0,
      cappedAtLimit: false,
      stampFailed: false,
    });
  }

  if (!tokens || tokens.length === 0) {
    return recordSkip({
      sent: 0,
      failed: 0,
      errors: [],
      platform,
      eligible: 0,
      cappedAtLimit: false,
      stampFailed: false,
    });
  }

  const messages: ExpoPushMessage[] = tokens.map((t) => ({
    to: t.token,
    title,
    body,
    data,
    sound: 'default' as const,
    channelId: 'general',
    priority: 'default',
  }));

  let sendResult: NotificationSendResult;
  let okTokenIds: string[] = [];
  let stampFailed = false;
  try {
    const tickets = await sendPushNotifications(messages);
    okTokenIds = tokens
      .filter((_, i) => tickets[i]?.status === 'ok')
      .map((t) => t.id);
    sendResult = await processTickets(tickets, tokens, supabase, {
      appType,
      channel: 'general',
      notificationType: 'mobile_update_available',
    });
  } catch (err) {
    sendResult = {
      sent: 0,
      failed: tokens.length,
      errors: [err instanceof Error ? err.message : 'Unknown push send error'],
    };
  }

  // Throttle: stamp only the devices that actually received the nudge. Chunk the
  // id list so the PATCH .in() filter never exceeds gateway URL-length limits —
  // a single run can match up to `limit` (5k) tokens.
  for (const idChunk of chunkArray(okTokenIds, UPDATE_NUDGE_STAMP_CHUNK_SIZE)) {
    const { error: stampError } = await supabase
      .from('push_tokens')
      .update({ last_update_push_at: nowIso })
      .in('id', idChunk);
    if (stampError) {
      stampFailed = true;
      logger.error({
        message: 'Failed to stamp last_update_push_at for nudged tokens',
        error: stampError,
      });
    }
  }

  await recordPushAttempt(supabase, {
    appType,
    channel: 'general',
    notificationType: 'mobile_update_available',
    title,
    body,
    payload: data,
    tokenCount: tokens.length,
    result: sendResult,
  });

  return {
    ...sendResult,
    platform,
    eligible: tokens.length,
    cappedAtLimit: tokens.length === limit,
    stampFailed,
  };
}

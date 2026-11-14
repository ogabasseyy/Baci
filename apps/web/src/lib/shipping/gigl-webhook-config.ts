import 'server-only';

export interface GiglWebhookConfig {
  /** `secret` returned by GIG's add-webhook-user registration. */
  secret: string;
  /** `userId` of Baci's GIG account, from the same registration response. */
  userId: string;
  /** `channelCode` of Baci's GIG account (login's UserChannelCode). */
  channelCode: string;
}

/**
 * Reads the GIG webhook settings from the server environment, like every
 * other GIGL_* setting (gigl.constants.ts). Returns null unless all three
 * are present, so the route fails closed before reading any body.
 *
 * - GIGL_WEBHOOK_ENCRYPTION_SECRET: decrypts deliveries. Deliberately not
 *   GIGL_WEBHOOK_SECRET: that name arms the legacy HMAC branch of
 *   /api/shipping/webhooks/[provider], which GIG's scheme never uses.
 * - GIGL_WEBHOOK_USER_ID / GIGL_WEBHOOK_CHANNEL_CODE: the account a
 *   decrypted delivery must name.
 */
export function readGiglWebhookConfig(
  env: Readonly<Record<string, string | undefined>>
): GiglWebhookConfig | null {
  const secret = env.GIGL_WEBHOOK_ENCRYPTION_SECRET?.trim();
  const userId = env.GIGL_WEBHOOK_USER_ID?.trim();
  const channelCode = env.GIGL_WEBHOOK_CHANNEL_CODE?.trim();
  if (!secret || !userId || !channelCode) return null;
  return { secret, userId, channelCode };
}

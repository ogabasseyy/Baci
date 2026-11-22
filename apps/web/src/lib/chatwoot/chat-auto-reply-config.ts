import 'server-only';

import {
  getMerchantInboxBinding,
  type MerchantInboxBinding,
} from './merchant-inbox-config';

export type ChatAutoReplyBinding = MerchantInboxBinding & {
  botApiAccessToken: string;
};

/**
 * The store's inbox binding, only when the assistant may answer for it:
 * switched on, and the bot credential is present. Anything else is off, so a
 * half-configured store never replies as a staff member by accident.
 */
export function getChatAutoReplyBinding(
  merchantId: string,
  env: NodeJS.ProcessEnv = process.env
): ChatAutoReplyBinding | null {
  if (env.EKAETTE_CHATWOOT_AI_REPLY_ENABLED !== 'true') return null;
  const binding = getMerchantInboxBinding(merchantId, env);
  if (!binding?.botApiAccessToken) return null;
  return { ...binding, botApiAccessToken: binding.botApiAccessToken };
}

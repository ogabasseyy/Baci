import type { GuestOAuthGrant } from './guest-oauth';

/** Encrypted with the grant; never exposed to MCP tools or the model. Only
 * the immediately previous authenticated rotation can recover for 30 seconds. */
export function refreshReceipt(grant: GuestOAuthGrant, accessToken: string, refreshToken: string, accessExpiresAt: number, now: number) {
  return grant.refreshHash ? { previousHash: grant.refreshHash, nextHash: '', accessToken, refreshToken,
    accessExpiresAt, recoverUntil: Math.min(now + 30_000, grant.expiresAt) } : undefined;
}
export function recoverRefresh(grant: GuestOAuthGrant, previousHash: string, now: number) {
  const receipt = grant.refreshReceipt;
  if (!receipt || receipt.previousHash !== previousHash || receipt.nextHash !== grant.refreshHash ||
    receipt.recoverUntil <= now || receipt.accessExpiresAt <= now) return undefined;
  return { access_token: receipt.accessToken, refresh_token: receipt.refreshToken, token_type: 'Bearer' as const,
    expires_in: Math.max(0, Math.floor((receipt.accessExpiresAt - now) / 1000)), scope: 'cart:write' };
}

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Self-authenticating refresh handles keep replay history in one encrypted grant. */
export function mintRefreshToken(grantId: string, generation: number, key: string): string {
  const payload = grantId.replaceAll('-', '') + generation.toString(16).padStart(8, '0');
  const mac = createHmac('sha256', Buffer.from(key, 'hex'))
    .update(`baci-guest-refresh:v1:${payload}`).digest('hex');
  return payload + mac;
}

export function refreshGrantId(token: string): string | null {
  if (!/^[a-f0-9]{104}$/.test(token)) return null;
  const id = token.slice(0, 32);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

/** Authenticate before treating an old generation as replay; forgery cannot revoke. */
export function authenticRefreshToken(token: string, grantId: string, key?: string): boolean {
  if (!key || refreshGrantId(token) !== grantId) return false;
  const expected = mintRefreshToken(grantId, Number.parseInt(token.slice(32, 40), 16), key);
  return timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'));
}

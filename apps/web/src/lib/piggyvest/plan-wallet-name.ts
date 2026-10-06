import 'server-only';
import { createHash } from 'node:crypto';
import { PIGGYVEST_PLAN_WALLET_NAME as limits } from './plan-wallet-name.constants';

export function buildPiggyvestPlanWalletName({
  integrationId,
  goalId,
  customerName,
}: {
  integrationId: string;
  goalId: string;
  customerName?: string;
}): string {
  const hash = createHash('sha256')
    .update(`${integrationId}:${goalId}`)
    .digest('hex');
  if (customerName === undefined) {
    return `baci${hash.slice(0, limits.legacyHashCharacters)}`;
  }
  const normalized = customerName
    .normalize('NFKC')
    .replace(/[^\p{L}\p{M}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const name =
    Array.from(normalized)
      .slice(
        0,
        limits.maxCharacters - limits.label.length - limits.suffixCharacters
      )
      .join('')
      .trim() || limits.fallbackCustomer;
  return `${name}${limits.label}${hash.slice(0, limits.suffixCharacters).toUpperCase()}`;
}

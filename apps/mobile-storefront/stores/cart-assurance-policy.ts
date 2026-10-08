import { CONFIG } from '@/lib/config';

/**
 * Native Smart Cart Pro assurance default, mirroring web's
 * resolveAssuranceDefault: Ogabassey builds with the gate enabled default
 * new lines to assured; every other merchant — and every build with the
 * gate disabled — stays opt-in.
 */
export function resolveNativeAssuranceDefault(): boolean {
  return CONFIG.ENABLE_SMART_CART_PRO && CONFIG.MERCHANT_SLUG === 'ogabassey';
}

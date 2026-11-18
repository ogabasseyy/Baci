import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';
import * as Crypto from 'expo-crypto';
import { CONFIG } from '@/lib/config';
import { normalizeImeiIdentifier } from './normalize-imei-identifier';

/**
 * Which rail paid: each keeps its own saved key, so a PiggyVest attempt and
 * a store credit request for one check never share an idempotency key.
 * 'imei' is the PiggyVest name already saved on phones: never rename it.
 */
export type ImeiPurchaseRail = 'imei' | 'imei-credit';

/**
 * The saved-key name of one IMEI check (per rail, account, store, device,
 * tier and IMEI). The build's merchant, never the hydrated one: that can
 * still be null at startup, and the name must match after a restart. The
 * IMEI is hashed so the saved purchase doesn't show it in plain text (an
 * identifier, not a secret; the app's own storage is the boundary).
 */
export async function imeiPurchaseName(
  rail: ImeiPurchaseRail,
  userId: string,
  device: ImeiDeviceCategory | '',
  tier: ImeiServiceTierKey,
  imei: string
) {
  const imeiHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    // One device, one key, however it was typed (spaces, case).
    normalizeImeiIdentifier(imei)
  );
  return `${rail}|${userId}|${CONFIG.MERCHANT_ID ?? ''}|${device}|${tier}|${imeiHash}`;
}

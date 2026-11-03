import type { PiggyvestPrimaryScopedRefusalCode } from '@/schemas/piggyvest-primary-wallet-capability';

/** Both floors set: iOS 120, Android 700. */
export const floors = {
  PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_IOS: '120',
  PIGGYVEST_PRIMARY_MIN_CLIENT_BUILD_ANDROID: '700',
} as unknown as NodeJS.ProcessEnv;

export function client(platform?: string, build?: string): Headers {
  const headers = new Headers();
  if (platform !== undefined) headers.set('X-Baci-Client-Platform', platform);
  if (build !== undefined) headers.set('X-Baci-Client-Build', build);
  return headers;
}

export const refused = (
  reason: string,
  code: PiggyvestPrimaryScopedRefusalCode = 'PRIMARY_CARD_NOT_READY'
) => ({
  enabled: false,
  status: 'not_ready',
  code,
  reason,
});

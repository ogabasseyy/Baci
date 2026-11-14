import { useQuery } from '@tanstack/react-query';
import { EXPO_PUBLIC_API_URL } from '@/env';
import { CONFIG } from '@/lib/config';
import { resolveStorefrontApiBaseUrl } from '@/lib/storefront-api-url';
import { blackFridayResponseSchema } from '@/schemas/black-friday';

export const isOgabasseyApp = CONFIG.MERCHANT_SLUG === 'ogabassey';

export async function fetchBlackFridayProducts(signal?: AbortSignal) {
  const previewOrigin = __DEV__
    ? process.env.EXPO_PUBLIC_BLACK_FRIDAY_PREVIEW_ORIGIN
    : undefined;
  const origin = resolveStorefrontApiBaseUrl(
    previewOrigin ?? EXPO_PUBLIC_API_URL
  );
  const response = await fetch(`${origin}/api/storefront/black-friday`, {
    signal,
  });
  if (!response.ok) {
    throw new Error('Black Friday products are temporarily unavailable.');
  }
  return blackFridayResponseSchema.parse(await response.json()).products;
}

export function useBlackFriday() {
  return useQuery({
    queryKey: [
      'ogabassey',
      'black-friday',
      __DEV__ ? process.env.EXPO_PUBLIC_BLACK_FRIDAY_PREVIEW_ORIGIN : undefined,
    ],
    queryFn: ({ signal }) => fetchBlackFridayProducts(signal),
    enabled: isOgabasseyApp,
    staleTime: 60_000,
  });
}
